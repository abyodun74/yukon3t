"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser, requireVerifiedViewer, viewerRateLimitKey } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";
import { getBlockedEitherWayIds } from "@/lib/blocks";
import { captureError } from "@/lib/error-tracking";
import { filterCircleContentViewers } from "@/lib/circle-permissions";
import { pushActivityNotificationToMany } from "@/lib/notify-push";
import { sendFcmActivityToUsers } from "@/lib/fcm";
import { eventChangePushBody, nameOrSomeone } from "@/lib/push-text";
import { publishEvents } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import {
  bringItemTextSchema,
  circleEventIdSchema,
  circleEventListSchema,
  eventCancelSchema,
  eventRescheduleSchema,
} from "@/lib/validations";
import {
  canAddBringItem,
  eventChangeError,
  eventChangeRecipients,
  normalizeBringItemText,
  normalizeEventChangeReason,
  nudgeClaimCutoff,
  nudgeError,
  nudgeRecipients,
  rescheduleTimeError,
} from "@/lib/circle-events";
import {
  circleEventsScope,
  loadBringItems,
  loadCircleEventAccess,
  loadCircleEventPage,
  loadCircleEventPanel,
  nudgeCandidates,
  type CircleEventAccess,
} from "@/lib/circle-events-data";

/**
 * Circle events: "Coming up" paging, "Who's bringing what", "Remind people who haven't replied" and stopping a
 * repeating event. Every action: the actor from the session, access from circle-events-data.ts (the event post must be
 * a published Circle event the actor can see, else not_found), input through Zod and the pure rules in
 * lib/circle-events.ts, then Prisma. Item text passes moderateText and is refused if flagged. Replies (Going / Maybe)
 * are setRsvp (actions/rsvp.ts). Claiming a bring-list item needs no reply at all, as before: any member who can see
 * the event may claim, whatever they answered.
 */

type EventError =
  | "rate_limited"
  | "invalid"
  | "not_found"
  | "forbidden"
  | "moderation"
  | "too_many"
  | "taken"
  | "past_event"
  | "too_soon"
  | "nobody"
  | "not_repeating"
  | "cancelled"
  | "invalid_time"
  | "same_time";

function failure(error: EventError) {
  return { error } as const;
}

function revalidateEvent(post: { id: string; circle: { slug: string } }) {
  revalidatePath(`/post/${post.id}`);
  revalidatePath(`/circles/${post.circle.slug}`);
}

async function eventFor(postId: unknown, user: { id: string; isAdmin: boolean }) {
  const parsed = circleEventIdSchema.safeParse(postId);
  if (!parsed.success) return null;
  return loadCircleEventAccess(parsed.data, user);
}

async function itemWithEvent(itemId: unknown, user: { id: string; isAdmin: boolean }) {
  const parsed = circleEventIdSchema.safeParse(itemId);
  if (!parsed.success) return null;
  const item = await prisma.eventBringItem.findUnique({
    where: { id: parsed.data },
    select: { id: true, postId: true, claimedById: true },
  });
  if (!item) return null;
  const access = await loadCircleEventAccess(item.postId, user);
  if (!access) return null;
  return { item, access };
}

async function itemsResult(access: CircleEventAccess, viewerId: string) {
  revalidateEvent(access.post);
  return { error: null, items: await loadBringItems(access.post.id, viewerId, access.isOrganizer) } as const;
}

/** "Load more" on a Circle's "Coming up": the page after `cursor`, with the same visibility as the page itself. */
export async function loadCircleEvents(input: unknown) {
  const user = await requireVerifiedViewer();
  if (!(await checkRateLimit("circleEventList", await viewerRateLimitKey(user)))) return failure("rate_limited");
  const parsed = circleEventListSchema.safeParse(input);
  if (!parsed.success) return failure("invalid");
  const scope = await circleEventsScope(parsed.data.circleId, user, new Date());
  if (!scope) return failure("not_found");
  const page = await loadCircleEventPage(scope.where, user.id, parsed.data.cursor ?? null);
  return { error: null, ...page } as const;
}

/** Organizer only: adds an item to the event's bring list (at most EVENT_BRING_ITEMS_MAX, counted under a row lock). */
export async function addBringItem(postId: unknown, text: unknown) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("eventOrganize", user.id))) return failure("rate_limited");
  const parsedText = bringItemTextSchema.safeParse(text);
  if (!parsedText.success) return failure("invalid");
  const normalized = normalizeBringItemText(parsedText.data);
  if (!normalized) return failure("invalid");

  const access = await eventFor(postId, user);
  if (!access) return failure("not_found");
  if (!access.isOrganizer) return failure("forbidden");
  if (access.post.eventCancelledAt) return failure("cancelled");

  const moderation = await moderateText(normalized);
  if (!moderation.allowed) return failure("moderation");

  const added = await prisma.$transaction(async (tx) => {
    // Serializes adds to one event, so two quick adds can't both pass the count check.
    await tx.$queryRaw`SELECT "id" FROM "Post" WHERE "id" = ${access.post.id} FOR UPDATE`;
    const existing = await tx.eventBringItem.aggregate({
      where: { postId: access.post.id },
      _count: { _all: true },
      _max: { position: true },
    });
    if (!canAddBringItem(existing._count._all)) return false;
    await tx.eventBringItem.create({
      data: { postId: access.post.id, text: normalized, position: (existing._max.position ?? -1) + 1 },
    });
    return true;
  });
  if (!added) return failure("too_many");
  return itemsResult(access, user.id);
}

/** Organizer only: renames an item. A claim on it stays (the claimer can let it go, or an organizer can unassign). */
export async function updateBringItem(itemId: unknown, text: unknown) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("eventOrganize", user.id))) return failure("rate_limited");
  const parsedText = bringItemTextSchema.safeParse(text);
  if (!parsedText.success) return failure("invalid");
  const normalized = normalizeBringItemText(parsedText.data);
  if (!normalized) return failure("invalid");

  const found = await itemWithEvent(itemId, user);
  if (!found) return failure("not_found");
  if (!found.access.isOrganizer) return failure("forbidden");
  if (found.access.post.eventCancelledAt) return failure("cancelled");

  const moderation = await moderateText(normalized);
  if (!moderation.allowed) return failure("moderation");

  await prisma.eventBringItem.updateMany({ where: { id: found.item.id, postId: found.access.post.id }, data: { text: normalized } });
  return itemsResult(found.access, user.id);
}

/** Organizer only: removes an item (and its claim). */
export async function removeBringItem(itemId: unknown) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("eventOrganize", user.id))) return failure("rate_limited");
  const found = await itemWithEvent(itemId, user);
  if (!found) return failure("not_found");
  if (!found.access.isOrganizer) return failure("forbidden");
  await prisma.eventBringItem.deleteMany({ where: { id: found.item.id, postId: found.access.post.id } });
  return itemsResult(found.access, user.id);
}

/**
 * A member who can see the event claims an unclaimed item. The write is guarded on claimedById still being null, so
 * of two people tapping at once exactly one gets it; the other answers `taken` with the fresh list.
 */
export async function claimBringItem(itemId: unknown) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("eventBringClaim", user.id))) return failure("rate_limited");
  const found = await itemWithEvent(itemId, user);
  if (!found) return failure("not_found");
  if (!found.access.isMember) return failure("forbidden");
  if (found.access.post.eventCancelledAt) return failure("cancelled");
  const claimed = await prisma.eventBringItem.updateMany({
    where: { id: found.item.id, postId: found.access.post.id, claimedById: null },
    data: { claimedById: user.id, claimedAt: new Date() },
  });
  const result = await itemsResult(found.access, user.id);
  return claimed.count === 0 ? ({ ...result, error: "taken" } as const) : result;
}

/**
 * Clears a claim: the claimer letting their own item go, or an organizer unassigning anyone's. Guarded on the claimer
 * read, so it never clears a claim someone else made in between.
 */
export async function unclaimBringItem(itemId: unknown) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("eventBringClaim", user.id))) return failure("rate_limited");
  const found = await itemWithEvent(itemId, user);
  if (!found) return failure("not_found");
  const { item, access } = found;
  if (!item.claimedById) return itemsResult(access, user.id);
  if (item.claimedById !== user.id && !access.isOrganizer) return failure("forbidden");
  await prisma.eventBringItem.updateMany({
    where: { id: item.id, postId: access.post.id, claimedById: item.claimedById },
    data: { claimedById: null, claimedAt: null },
  });
  return itemsResult(access, user.id);
}

/**
 * Organizer only, future events only: EVENT_RSVP_NUDGE (bell + FCM push) to the Circle members who can open the
 * event's channel and haven't RSVP'd, minus the author, the sender and anyone blocked either way with either; at most
 * EVENT_NUDGE_MAX_RECIPIENTS. Once per event per EVENT_NUDGE_COOLDOWN_MS: Post.eventNudgedAt is claimed with a
 * guarded updateMany before anything is sent, so two organizers pressing at once send one nudge. When nobody is left
 * to remind, nothing is claimed (`nobody`).
 */
export async function nudgeEventNonResponders(postId: unknown) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("eventNudge", user.id))) return failure("rate_limited");
  const access = await eventFor(postId, user);
  if (!access) return failure("not_found");
  if (!access.isOrganizer) return failure("forbidden");
  const { post } = access;
  const now = new Date();
  const timing = nudgeError(post, now);
  if (timing) return failure(timing);

  const [candidates, rsvps, blockedByActor, blockedByAuthor] = await Promise.all([
    nudgeCandidates({ circleId: post.circle.id, circleOwnerId: post.circle.createdById, channel: post.channel }),
    // A Maybe has replied too: only people with no reply at all are nudged.
    prisma.postRsvp.findMany({ where: { postId: post.id }, select: { userId: true } }),
    getBlockedEitherWayIds(user.id),
    post.authorId === user.id ? Promise.resolve(new Set<string>()) : getBlockedEitherWayIds(post.authorId),
  ]);
  const recipients = nudgeRecipients(candidates, {
    actorId: user.id,
    authorId: post.authorId,
    rsvpUserIds: new Set(rsvps.map((r) => r.userId)),
    blockedIds: new Set([...blockedByActor, ...blockedByAuthor]),
  });
  if (recipients.length === 0) return failure("nobody");

  const claimed = await prisma.post.updateMany({
    where: {
      id: post.id,
      eventAt: { gt: now },
      eventCancelledAt: null,
      OR: [{ eventNudgedAt: null }, { eventNudgedAt: { lte: nudgeClaimCutoff(now) } }],
    },
    data: { eventNudgedAt: now },
  });
  if (claimed.count === 0) return failure("too_soon");

  try {
    await prisma.notification.createMany({
      data: recipients.map((recipientId) => ({
        recipientId,
        actorId: user.id,
        type: "EVENT_RSVP_NUDGE" as const,
        postId: post.id,
        circleId: post.circle.id,
      })),
    });
    await pushActivityNotificationToMany(recipients, "EVENT_RSVP_NUDGE", user.name, `/post/${post.id}`);
    await publishEvents(recipients.map((id) => ({ channel: REALTIME_CHANNELS.navBadges(id), event: "changed" })));
  } catch (err) {
    // The nudge is claimed; a partial failure is logged rather than retried, so nobody is reminded twice.
    console.error("[circle-events] nudge fan-out failed", err);
    await captureError(err, { action: "nudgeEventNonResponders", postId: post.id });
  }
  revalidateEvent(post);
  return { error: null, sent: recipients.length } as const;
}

/** Organizer only: stops a repeating event. Occurrences already posted stay; no new one is created. */
export async function stopEventSeries(postId: unknown) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("eventOrganize", user.id))) return failure("rate_limited");
  const access = await eventFor(postId, user);
  if (!access) return failure("not_found");
  if (!access.isOrganizer) return failure("forbidden");
  const seriesId = access.post.eventSeriesId;
  if (!seriesId) return failure("not_repeating");
  await prisma.eventSeries.updateMany({ where: { id: seriesId, endedAt: null }, data: { endedAt: new Date() } });
  revalidateEvent(access.post);
  return { error: null } as const;
}

/**
 * The event panel ("Event details" on an event card in a Circle, Home or a profile) for one event, loaded when opened:
 * the same data /post/[id] renders under the post, with the same access rule (not_found otherwise).
 */
export async function loadCircleEventDetails(postId: unknown) {
  const user = await requireVerifiedViewer();
  if (!(await checkRateLimit("circleEventList", await viewerRateLimitKey(user)))) return failure("rate_limited");
  const parsed = circleEventIdSchema.safeParse(postId);
  if (!parsed.success) return failure("invalid");
  const data = await loadCircleEventPanel(parsed.data, user);
  if (!data) return failure("not_found");
  return { error: null, data } as const;
}

/**
 * Bell + FCM push to eventChangeRecipients (author, everyone going, everyone bringing something; never the organizer
 * acting, nobody blocked either way with them), ACTIVE accounts only. Best-effort after the change is committed: a
 * failure is logged, not retried, so nobody hears about one change twice.
 */
async function notifyEventChange(
  post: { id: string; authorId: string; circle: { id: string } },
  actor: { id: string; name: string | null },
  type: "EVENT_CANCELLED" | "EVENT_RESCHEDULED",
  details: { newAt?: Date; reason: string | null },
) {
  try {
    const [rsvps, claims, blocked] = await Promise.all([
      // Going and Maybe alike: anyone who replied hears that the event was cancelled or moved.
      prisma.postRsvp.findMany({ where: { postId: post.id }, orderBy: { createdAt: "asc" }, select: { userId: true } }),
      prisma.eventBringItem.findMany({
        where: { postId: post.id, claimedById: { not: null } },
        select: { claimedById: true },
      }),
      getBlockedEitherWayIds(actor.id),
    ]);
    const recipients = eventChangeRecipients({
      actorId: actor.id,
      authorId: post.authorId,
      rsvpUserIds: rsvps.map((r) => r.userId),
      claimerIds: claims.map((c) => c.claimedById),
      blockedIds: blocked,
    });
    // A PRIVATE Circle's change reaches its current members only (lib/circle-visibility.ts): not someone who RSVP'd or
    // claimed an item and has since left, nor an author who left.
    const viewers = await filterCircleContentViewers(post.circle.id, recipients);
    if (viewers.length === 0) return 0;
    const active = (
      await prisma.user.findMany({ where: { id: { in: viewers }, status: "ACTIVE" }, select: { id: true } })
    ).map((u) => u.id);
    if (active.length === 0) return 0;
    await prisma.notification.createMany({
      data: active.map((recipientId) => ({
        recipientId,
        actorId: actor.id,
        type,
        postId: post.id,
        circleId: post.circle.id,
      })),
    });
    await sendFcmActivityToUsers(active, (locale) => ({
      title: nameOrSomeone(actor.name, locale),
      body: eventChangePushBody(type, locale, details),
      type,
      url: `/post/${post.id}`,
    }));
    await publishEvents(active.map((id) => ({ channel: REALTIME_CHANNELS.navBadges(id), event: "changed" })));
    return active.length;
  } catch (err) {
    console.error(`[circle-events] ${type} fan-out failed`, err);
    await captureError(err, { action: "notifyEventChange", type, postId: post.id });
    return 0;
  }
}

/** A reason through normalizeEventChangeReason and moderateText: the text, null for none, or the error to answer. */
async function checkedReason(raw: string | null | undefined): Promise<{ reason: string | null } | { error: EventError }> {
  const reason = normalizeEventChangeReason(raw);
  if (reason === false) return { error: "invalid" };
  if (reason === null) return { reason: null };
  const moderation = await moderateText(reason);
  if (!moderation.allowed) return { error: "moderation" };
  return { reason };
}

/**
 * Organizer only, before the event starts: cancels it, with an optional reason. The post stays, marked cancelled; it
 * leaves "Coming up", takes no RSVPs or bring-list changes and gets no reminder. The claim is a guarded updateMany
 * (not cancelled, not started), so two organizers pressing at once cancel and notify once. Cancelling one date of a
 * repeating event leaves the series running, unless `stopSeries` also stops it (only one date is ever ahead, so that is
 * "cancel all future dates"). Notifies EVENT_CANCELLED (see notifyEventChange).
 */
export async function cancelCircleEvent(postId: unknown, input: unknown) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("eventOrganize", user.id))) return failure("rate_limited");
  const parsed = eventCancelSchema.safeParse(input);
  if (!parsed.success) return failure("invalid");
  const access = await eventFor(postId, user);
  if (!access) return failure("not_found");
  if (!access.isOrganizer) return failure("forbidden");
  const { post } = access;
  const now = new Date();
  const blocked = eventChangeError(post, now);
  if (blocked) return failure(blocked);

  const checked = await checkedReason(parsed.data.reason);
  if ("error" in checked) return failure(checked.error);

  const claimed = await prisma.post.updateMany({
    where: { id: post.id, eventCancelledAt: null, eventAt: { gt: now } },
    data: { eventCancelledAt: now, eventCancelReason: checked.reason },
  });
  if (claimed.count === 0) return failure("cancelled");

  if (parsed.data.stopSeries && post.eventSeriesId) {
    await prisma.eventSeries.updateMany({ where: { id: post.eventSeriesId, endedAt: null }, data: { endedAt: now } });
  }
  const notified = await notifyEventChange(post, user, "EVENT_CANCELLED", { reason: checked.reason });
  revalidateEvent(post);
  return { error: null, notified } as const;
}

/**
 * Organizer only, before the event starts: moves it to a new future time (within a year), with an optional reason.
 * RSVPs and the bring list stay; eventReminderSentAt is cleared so the "starting soon" reminder fires for the new time;
 * the time it was moved from is kept for the "Moved from" note. Guarded on the start time read (and not cancelled), so
 * of two simultaneous moves only one applies. A repeating event's next dates still come from the series rule
 * (anchor + index in lib/event-recurrence.ts), not from this post's time, so moving one date shifts only that date.
 * Notifies EVENT_RESCHEDULED with the new time and reason.
 */
export async function rescheduleCircleEvent(postId: unknown, input: unknown) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("eventOrganize", user.id))) return failure("rate_limited");
  const parsed = eventRescheduleSchema.safeParse(input);
  if (!parsed.success) return failure("invalid");
  const access = await eventFor(postId, user);
  if (!access) return failure("not_found");
  if (!access.isOrganizer) return failure("forbidden");
  const { post } = access;
  const now = new Date();
  const blocked = eventChangeError(post, now);
  if (blocked) return failure(blocked);
  const nextAt = new Date(parsed.data.eventAt);
  const timeError = rescheduleTimeError(post.eventAt, nextAt, now);
  if (timeError) return failure(timeError);

  const checked = await checkedReason(parsed.data.reason);
  if ("error" in checked) return failure(checked.error);

  const claimed = await prisma.post.updateMany({
    where: { id: post.id, eventCancelledAt: null, eventAt: post.eventAt },
    data: {
      eventAt: nextAt,
      eventPreviousAt: post.eventAt,
      eventRescheduledAt: now,
      eventRescheduleReason: checked.reason,
      eventReminderSentAt: null,
    },
  });
  if (claimed.count === 0) return failure("not_found");

  const notified = await notifyEventChange(post, user, "EVENT_RESCHEDULED", { newAt: nextAt, reason: checked.reason });
  revalidateEvent(post);
  return { error: null, notified } as const;
}
