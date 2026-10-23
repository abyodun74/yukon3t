"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";
import { getBlockedEitherWayIds } from "@/lib/blocks";
import { captureError } from "@/lib/error-tracking";
import { filterCircleContentViewers } from "@/lib/circle-permissions";
import { sendFcmActivityToUsers } from "@/lib/fcm";
import { eventAnnouncementPushBody, nameOrSomeone } from "@/lib/push-text";
import { publishEvents } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { getDictionary } from "@/lib/i18n/server";
import { deleteTranslationsOf } from "@/lib/translation-server";
import {
  circleEventIdSchema,
  eventAnnouncementEditSchema,
  eventAnnouncementSchema,
  eventAttendanceSchema,
  eventExportSchema,
  eventWalkInSearchSchema,
} from "@/lib/validations";
import { loadCircleEventAccess, type CircleEventAccess } from "@/lib/circle-events-data";
import {
  EVENT_ANNOUNCEMENTS_PER_DAY,
  announcementError,
  announcementRecipients,
  announcementWindowStart,
  canDeleteEventUpdate,
  canEditEventUpdate,
  canMarkAttended,
  checkInError,
  normalizeAnnouncementText,
  normalizeWalkInQuery,
  organizerToolAccess,
} from "@/lib/circle-event-organizer";
import {
  announcementQuota,
  eventAudience,
  exportOccurrencePosts,
  loadAttendanceSummary,
  loadCheckInList,
  loadEventExport,
  loadEventUpdates,
  searchWalkInCandidates,
} from "@/lib/circle-event-organizer-data";
import { buildEventExportCsv, eventExportFileName } from "@/lib/circle-event-export";

/**
 * Organizer tools on a Circle event: "Organizer updates" to everyone going, attendance check-in and the CSV export.
 * Every action: the actor from the session, its own limiter, the event through loadCircleEventAccess (a published
 * Circle event the actor can see, else not_found), organizer only (canOrganizeCircleEvent: the author while a member,
 * or the Circle's owner / co-admins; no site-admin shortcut), input through Zod and the pure rules in
 * lib/circle-event-organizer.ts, then Prisma. An update's text passes moderateText and is refused if flagged. No
 * AuditLog row, like the other organizer actions (AuditLog is for trust-and-safety actions on users); who sent an
 * update and who checked someone in is stored on the row itself.
 */

type OrganizerError =
  | "rate_limited"
  | "invalid"
  | "not_found"
  | "forbidden"
  | "moderation"
  | "cancelled"
  | "too_late"
  | "too_early"
  | "limit_reached"
  | "not_eligible"
  | "already_deleted";

function failure(error: OrganizerError) {
  return { error } as const;
}

/** The event and the actor's access to it, for an organizer only (not_found / forbidden otherwise). */
async function organizerEvent(
  postId: unknown,
  user: { id: string; isAdmin: boolean },
): Promise<{ access: CircleEventAccess } | { error: "invalid" | "not_found" | "forbidden" }> {
  const parsed = circleEventIdSchema.safeParse(postId);
  if (!parsed.success) return { error: "invalid" };
  const access = await loadCircleEventAccess(parsed.data, user);
  if (!access) return { error: "not_found" };
  if (!access.isOrganizer) return { error: "forbidden" };
  return { access };
}

/**
 * Organizer only, until EVENT_ANNOUNCE_AFTER_START_MS after the start, not on a cancelled event: posts a short update
 * (<= EVENT_ANNOUNCEMENT_MAX_LENGTH, moderated) that is pinned on the event and sent as EVENT_ANNOUNCEMENT (bell + FCM
 * push, the text under the organizer's name) to announcementRecipients: the author and everyone going, minus the
 * sender, anyone blocked either way with the sender or the author, and anyone who isn't a current ACTIVE member able to
 * open the event's channel (so someone who left, or a PRIVATE Circle's ex-member, hears nothing); at most
 * EVENT_ANNOUNCEMENT_MAX_RECIPIENTS. At most EVENT_ANNOUNCEMENTS_PER_DAY per event in any 24h, counted under a row lock
 * on the post so two organizers can't both take the last one. Recipients have opted in by RSVPing (un-RSVPing stops
 * them), like cancel / reschedule notices, so there is no separate setting. The fan-out is best-effort after the row is
 * committed: a failure is logged, not retried.
 */
export async function postEventAnnouncement(postId: unknown, input: unknown) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("eventAnnounce", user.id))) return failure("rate_limited");
  const parsed = eventAnnouncementSchema.safeParse(input);
  if (!parsed.success) return failure("invalid");
  const text = normalizeAnnouncementText(parsed.data.text);
  if (!text) return failure("invalid");

  const found = await organizerEvent(postId, user);
  if ("error" in found) return failure(found.error);
  const { post } = found.access;
  const now = new Date();
  const timing = announcementError(post, now);
  if (timing) return failure(timing);

  const moderation = await moderateText(text);
  if (!moderation.allowed) return failure("moderation");

  const announcement = await prisma.$transaction(async (tx) => {
    // Serializes updates to one event, so the per-event cap can't be passed by two at once.
    await tx.$queryRaw`SELECT "id" FROM "Post" WHERE "id" = ${post.id} FOR UPDATE`;
    const recent = await tx.eventAnnouncement.count({
      where: { postId: post.id, createdAt: { gt: announcementWindowStart(now) } },
    });
    if (recent >= EVENT_ANNOUNCEMENTS_PER_DAY) return null;
    return tx.eventAnnouncement.create({
      data: { postId: post.id, authorId: user.id, text },
      select: { id: true },
    });
  });
  if (!announcement) return failure("limit_reached");

  let notified = 0;
  try {
    const [rsvps, blockedByActor, blockedByAuthor] = await Promise.all([
      prisma.postRsvp.findMany({ where: { postId: post.id }, orderBy: { createdAt: "asc" }, select: { userId: true } }),
      getBlockedEitherWayIds(user.id),
      post.authorId === user.id ? Promise.resolve(new Set<string>()) : getBlockedEitherWayIds(post.authorId),
    ]);
    const candidates = [post.authorId, ...rsvps.map((r) => r.userId)];
    const audience = await eventAudience(post, candidates);
    const recipients = announcementRecipients({
      actorId: user.id,
      authorId: post.authorId,
      rsvpUserIds: rsvps.map((r) => r.userId),
      audience,
      blockedIds: new Set([...blockedByActor, ...blockedByAuthor]),
    });
    if (recipients.length > 0) {
      await prisma.notification.createMany({
        data: recipients.map((recipientId) => ({
          recipientId,
          actorId: user.id,
          type: "EVENT_ANNOUNCEMENT" as const,
          postId: post.id,
          circleId: post.circle.id,
        })),
      });
      await prisma.eventAnnouncement.update({
        where: { id: announcement.id },
        data: { recipientCount: recipients.length },
      });
      await sendFcmActivityToUsers(recipients, (locale) => ({
        title: nameOrSomeone(user.name, locale),
        body: eventAnnouncementPushBody(locale, text),
        type: "EVENT_ANNOUNCEMENT",
        url: `/post/${post.id}`,
      }));
      await publishEvents(recipients.map((id) => ({ channel: REALTIME_CHANNELS.navBadges(id), event: "changed" })));
    }
    notified = recipients.length;
  } catch (err) {
    console.error("[circle-event-organizer] announcement fan-out failed", err);
    await captureError(err, { action: "postEventAnnouncement", postId: post.id });
  }

  revalidatePath(`/post/${post.id}`);
  const [updates, quota] = await Promise.all([
    loadEventUpdates(post.id, user.id, true),
    announcementQuota(post.id, now),
  ]);
  return {
    error: null,
    notified,
    updates,
    announcementsLeft: quota.left,
    nextAnnouncementAt: quota.nextAt?.toISOString() ?? null,
  } as const;
}

/**
 * Organizer only, once the check-in window has opened (also after it closed, read-only): the check-in list (everyone
 * going, then walk-ins checked in) and the going-vs-attended summary. See loadCheckInList for who is listed.
 */
export async function loadEventCheckIn(postId: unknown) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("eventCheckIn", user.id))) return failure("rate_limited");
  const found = await organizerEvent(postId, user);
  if ("error" in found) return failure(found.error);
  const { post } = found.access;
  const tools = organizerToolAccess({
    isOrganizer: true,
    eventAt: post.eventAt,
    eventCancelledAt: post.eventCancelledAt,
    now: new Date(),
  });
  if (post.eventCancelledAt) return failure("cancelled");
  if (!tools.viewAttendance) return failure("too_early");
  const list = await loadCheckInList(post, user.id);
  return { error: null, editable: tools.editAttendance, ...list } as const;
}

/**
 * Organizer only, while the check-in window is open: marks one person as attended (or not). They must have replied
 * Going or Maybe (and still be able to see the event) or, as a walk-in, a current ACTIVE member who can open the event's channel; never anyone
 * blocked either way with the organizer, never an inactive account (`not_eligible`). Ticking twice keeps one row (the
 * first organizer's who/when); unticking deletes it. Answers the fresh summary.
 */
export async function setEventAttendance(postId: unknown, input: unknown) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("eventCheckIn", user.id))) return failure("rate_limited");
  const parsed = eventAttendanceSchema.safeParse(input);
  if (!parsed.success) return failure("invalid");
  const found = await organizerEvent(postId, user);
  if ("error" in found) return failure(found.error);
  const { post } = found.access;
  const timing = checkInError(post, new Date());
  if (timing) return failure(timing);
  const { userId, attended } = parsed.data;

  if (!attended) {
    await prisma.eventAttendance.deleteMany({ where: { postId: post.id, userId } });
  } else {
    const [target, rsvp, blocked, audience] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { status: true } }),
      prisma.postRsvp.findUnique({ where: { userId_postId: { userId, postId: post.id } }, select: { id: true } }),
      getBlockedEitherWayIds(user.id),
      eventAudience(post, [userId]),
    ]);
    if (!target || target.status !== "ACTIVE") return failure("not_eligible");
    // Someone who replied still has to be able to see the event: a PRIVATE Circle's ex-member isn't checked in.
    const hasReplied = !!rsvp && (await filterCircleContentViewers(post.circle.id, [userId])).length > 0;
    if (!canMarkAttended({ userId, hasReplied, audience, blockedIds: blocked })) return failure("not_eligible");
    await prisma.eventAttendance.upsert({
      where: { postId_userId: { postId: post.id, userId } },
      create: { postId: post.id, userId, walkIn: !rsvp, checkedInById: user.id },
      update: {},
    });
  }
  return { error: null, attended, summary: await loadAttendanceSummary(post.id) } as const;
}

/** Organizer only, while check-in is open: "Add a walk-in" search among the Circle's members (searchWalkInCandidates). */
export async function searchEventWalkIns(postId: unknown, input: unknown) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("eventCheckIn", user.id))) return failure("rate_limited");
  const parsed = eventWalkInSearchSchema.safeParse(input);
  if (!parsed.success) return failure("invalid");
  const query = normalizeWalkInQuery(parsed.data.query);
  if (!query) return { error: null, candidates: [] } as const;
  const found = await organizerEvent(postId, user);
  if ("error" in found) return failure(found.error);
  const timing = checkInError(found.access.post, new Date());
  if (timing) return failure(timing);
  return { error: null, candidates: await searchWalkInCandidates(found.access.post, user.id, query) } as const;
}

/**
 * Organizer only, at any time: the CSV of this event, or of every date of its repeating series (`scope: "series"`):
 * per person, display name, @username, going or not, when they said so, attended or not, and the bring-list items they
 * claimed. Nothing else about anyone (no email, phone or other private data), nobody blocked either way with the
 * organizer, ACTIVE accounts only, and for a PRIVATE Circle only current members (loadEventExport). Cells are
 * neutralized against formula injection and the file name is sanitized (lib/csv.ts). Returns the text without the
 * byte-order mark: the browser adds it to the downloaded file, and the native app (whose WebView can't download files)
 * shows the text to copy instead. Column titles are in the organizer's language. eventExport limiter: 10 an hour.
 */
export async function exportCircleEventCsv(postId: unknown, input: unknown) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("eventExport", user.id))) return failure("rate_limited");
  const parsed = eventExportSchema.safeParse(input);
  if (!parsed.success) return failure("invalid");
  const found = await organizerEvent(postId, user);
  if ("error" in found) return failure(found.error);
  const { post } = found.access;
  const series = parsed.data.scope === "series" && !!post.eventSeriesId;

  const occurrences = await exportOccurrencePosts(post, series);
  const data = await loadEventExport(post.circle.id, occurrences, user.id);
  const dictionary = await getDictionary();
  const labels = { ...dictionary.ui.eventTools.csv, untitled: dictionary.ui.events.untitled };
  const csv = buildEventExportCsv(data, labels);
  const first = occurrences[0] ?? { content: post.content, eventAt: post.eventAt };
  return {
    error: null,
    csv,
    fileName: eventExportFileName(data[0]?.title ?? "", first.eventAt, series),
    rows: data.reduce((sum, o) => sum + o.people.length, 0),
  } as const;
}

/** An update and the actor's access to its event (not_found when either is gone or out of sight). */
async function updateWithEvent(updateId: unknown, user: { id: string; isAdmin: boolean }) {
  const parsed = circleEventIdSchema.safeParse(updateId);
  if (!parsed.success) return null;
  const update = await prisma.eventAnnouncement.findUnique({
    where: { id: parsed.data },
    select: { id: true, postId: true, authorId: true, deletedAt: true },
  });
  if (!update) return null;
  const access = await loadCircleEventAccess(update.postId, user);
  if (!access) return null;
  return { update, access };
}

/**
 * Its author, while still an organizer of the event: changes an update's text (same rules as posting: normalized,
 * <= EVENT_ANNOUNCEMENT_MAX_LENGTH, moderateText and refused if flagged). Marked edited; nobody is notified again, and
 * its cached translations are dropped (the old wording is never served again). Any time, also after the event.
 */
export async function editEventAnnouncement(updateId: unknown, input: unknown) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("eventOrganize", user.id))) return failure("rate_limited");
  const parsed = eventAnnouncementEditSchema.safeParse(input);
  if (!parsed.success) return failure("invalid");
  const text = normalizeAnnouncementText(parsed.data.text);
  if (!text) return failure("invalid");
  const found = await updateWithEvent(updateId, user);
  if (!found) return failure("not_found");
  const { update, access } = found;
  if (update.deletedAt) return failure("already_deleted");
  const rule = { viewerId: user.id, authorId: update.authorId, isOrganizer: access.isOrganizer, deleted: false };
  if (!canEditEventUpdate(rule)) return failure("forbidden");

  const moderation = await moderateText(text);
  if (!moderation.allowed) return failure("moderation");

  const changed = await prisma.eventAnnouncement.updateMany({
    where: { id: update.id, authorId: user.id, deletedAt: null },
    data: { text, editedAt: new Date() },
  });
  if (changed.count === 0) return failure("already_deleted");
  await deleteTranslationsOf("eventUpdate", update.id);
  revalidatePath(`/post/${update.postId}`);
  return { error: null, updates: await loadEventUpdates(update.postId, user.id, access.isOrganizer) } as const;
}

/**
 * Any organizer of the event, or the update's author: removes it from the event. The text is erased and the row kept
 * (deletedAt) only so it still counts toward the event's daily cap; its cached translations are deleted. Notifications
 * already sent stay (they only link to the event).
 */
export async function deleteEventAnnouncement(updateId: unknown) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("eventOrganize", user.id))) return failure("rate_limited");
  const found = await updateWithEvent(updateId, user);
  if (!found) return failure("not_found");
  const { update, access } = found;
  if (update.deletedAt) return failure("already_deleted");
  const rule = { viewerId: user.id, authorId: update.authorId, isOrganizer: access.isOrganizer, deleted: false };
  if (!canDeleteEventUpdate(rule)) return failure("forbidden");

  const changed = await prisma.eventAnnouncement.updateMany({
    where: { id: update.id, deletedAt: null },
    data: { deletedAt: new Date(), text: "" },
  });
  if (changed.count === 0) return failure("already_deleted");
  await deleteTranslationsOf("eventUpdate", update.id);
  revalidatePath(`/post/${update.postId}`);
  return { error: null, updates: await loadEventUpdates(update.postId, user.id, access.isOrganizer) } as const;
}
