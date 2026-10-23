import { prisma } from "@/lib/prisma";
import { getBlockedEitherWayIds } from "@/lib/blocks";
import { filterCircleContentViewers } from "@/lib/circle-permissions";
import { eventTitle } from "@/lib/circle-events";
import type { CircleEventAccess } from "@/lib/circle-events-data";
import {
  EVENT_ANNOUNCEMENTS_SHOWN,
  EVENT_ANNOUNCEMENT_WINDOW_MS,
  EVENT_CHECK_IN_LIST_MAX,
  EVENT_EXPORT_MAX_OCCURRENCES,
  EVENT_WALK_IN_SEARCH_LIMIT,
  announcementWindowStart,
  announcementsLeft,
  attendanceSummary,
  canDeleteEventUpdate,
  canEditEventUpdate,
  checkInWindow,
  organizerToolAccess,
  type CheckInState,
} from "@/lib/circle-event-organizer";
import type { EventExportOccurrence, EventExportPerson } from "@/lib/circle-event-export";
import type { RsvpStatus } from "@/lib/rsvp";

/**
 * The server half of the Circle event organizer tools (rules: lib/circle-event-organizer.ts). Callers have already
 * resolved the event and the viewer's access through loadCircleEventAccess (lib/circle-events-data.ts) and checked
 * isOrganizer for anything but the pinned updates. Only the fields each view shows are read from a User (id, name,
 * username, avatar), never a whole row (see "Never send a User row to a browser" in CLAUDE.md).
 */

type EventPost = CircleEventAccess["post"];

/**
 * Of `userIds`, the ones who are current, ACTIVE members of the event's Circle and can open its channel (a PRIVATE
 * channel: its allow-list, the Circle's owner and co-admins). Someone who left the Circle, or never joined, is not in it.
 */
export async function eventAudience(
  post: Pick<EventPost, "channel"> & { circle: { id: string; createdById: string } },
  userIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Set();
  const privateChannel = post.channel && post.channel.visibility !== "PUBLIC" ? post.channel : null;
  const [members, allowed] = await Promise.all([
    prisma.circleMembership.findMany({
      where: { circleId: post.circle.id, userId: { in: ids }, user: { status: "ACTIVE" } },
      select: { userId: true, role: true },
    }),
    privateChannel
      ? prisma.channelMembership.findMany({
          where: { channelId: privateChannel.id, userId: { in: ids } },
          select: { userId: true },
        })
      : Promise.resolve([] as { userId: string }[]),
  ]);
  const allowedIds = new Set(allowed.map((m) => m.userId));
  return new Set(
    members
      .filter(
        (m) => !privateChannel || allowedIds.has(m.userId) || m.role !== "MEMBER" || m.userId === post.circle.createdById,
      )
      .map((m) => m.userId),
  );
}

/** One pinned "Organizer update" as everyone who can see the event sees it. */
export type EventUpdateView = {
  id: string;
  text: string;
  authorName: string | null;
  /** ISO instant. */
  createdAt: string;
  /** Its author changed it (ISO instant), shown as "edited". */
  editedAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
};

/**
 * The latest EVENT_ANNOUNCEMENTS_SHOWN updates on an event, newest first, for anyone who can see it: not deleted, none
 * by an author who is no longer ACTIVE or is blocked either way with the viewer. `isOrganizer` (the viewer's) decides
 * the edit / delete controls (canEditEventUpdate / canDeleteEventUpdate); the actions decide again.
 */
export async function loadEventUpdates(postId: string, viewerId: string, isOrganizer: boolean): Promise<EventUpdateView[]> {
  const blocked = await getBlockedEitherWayIds(viewerId);
  const rows = await prisma.eventAnnouncement.findMany({
    where: {
      postId,
      deletedAt: null,
      author: { status: "ACTIVE" },
      ...(blocked.size ? { authorId: { notIn: [...blocked] } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: EVENT_ANNOUNCEMENTS_SHOWN,
    select: { id: true, text: true, createdAt: true, editedAt: true, authorId: true, author: { select: { name: true } } },
  });
  return rows.map((row) => {
    const rule = { viewerId, authorId: row.authorId, isOrganizer, deleted: false };
    return {
      id: row.id,
      text: row.text,
      authorName: row.author.name,
      createdAt: row.createdAt.toISOString(),
      editedAt: row.editedAt?.toISOString() ?? null,
      canEdit: canEditEventUpdate(rule),
      canDelete: canDeleteEventUpdate(rule),
    };
  });
}

/**
 * How many updates the event got in the current window, and when the oldest of them leaves it. Deleted ones count too
 * (their row stays, text erased), so deleting and re-sending can't push past the cap.
 */
export async function announcementQuota(postId: string, now: Date) {
  const recent = await prisma.eventAnnouncement.findMany({
    where: { postId, createdAt: { gt: announcementWindowStart(now) } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const left = announcementsLeft(recent.length);
  const nextAt = left === 0 && recent[0] ? new Date(recent[0].createdAt.getTime() + EVENT_ANNOUNCEMENT_WINDOW_MS) : null;
  return { sent: recent.length, left, nextAt };
}

export type AttendanceSummaryView = { going: number; maybe: number; attended: number; walkIns: number };

/** The organizers' "X going · Y maybe · Z attended" line: every reply and every check-in, counted. */
export async function loadAttendanceSummary(postId: string): Promise<AttendanceSummaryView> {
  const [replies, attendance] = await Promise.all([
    prisma.postRsvp.groupBy({ by: ["status"], where: { postId }, _count: { _all: true } }),
    prisma.eventAttendance.findMany({ where: { postId }, select: { userId: true, walkIn: true } }),
  ]);
  const count = (status: RsvpStatus) => replies.find((r) => r.status === status)?._count._all ?? 0;
  return attendanceSummary({ going: count("GOING"), maybe: count("MAYBE"), attendance });
}

/** The "Organizer tools" section's state for an organizer (null for everyone else). */
export type OrganizerToolsView = {
  announce: boolean;
  announcementsLeft: number;
  /** ISO instant another update is allowed at, when today's are used up. */
  nextAnnouncementAt: string | null;
  checkIn: { state: CheckInState; opensAt: string; closesAt: string; editable: boolean; viewable: boolean };
  /** Once check-in has opened: going vs attended. */
  summary: AttendanceSummaryView | null;
  /** The event is one date of a repeating event, so "All dates" can be exported. */
  canExportSeries: boolean;
};

export async function loadOrganizerTools(post: EventPost, now: Date): Promise<OrganizerToolsView> {
  const access = organizerToolAccess({
    isOrganizer: true,
    eventAt: post.eventAt,
    eventCancelledAt: post.eventCancelledAt,
    now,
  });
  const win = checkInWindow(post.eventAt, now);
  const [quota, summary] = await Promise.all([
    access.announce ? announcementQuota(post.id, now) : Promise.resolve(null),
    access.viewAttendance ? loadAttendanceSummary(post.id) : Promise.resolve(null),
  ]);
  return {
    announce: access.announce,
    announcementsLeft: quota?.left ?? 0,
    nextAnnouncementAt: quota?.nextAt?.toISOString() ?? null,
    checkIn: {
      state: win.state,
      opensAt: win.opensAt.toISOString(),
      closesAt: win.closesAt.toISOString(),
      editable: access.editAttendance,
      viewable: access.viewAttendance,
    },
    summary,
    canExportSeries: !!post.eventSeriesId,
  };
}

const personSelect = { id: true, name: true, username: true, avatarUrl: true } as const;

/** One row of the check-in list. */
export type CheckInPerson = {
  userId: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  /** Their reply (Going / Maybe), or null for a walk-in. */
  rsvp: RsvpStatus | null;
  attended: boolean;
  walkIn: boolean;
};

/**
 * The check-in list for an organizer: everyone who replied Going, then Maybe, then walk-ins already checked in; ACTIVE accounts only, nobody
 * blocked either way with the organizer, and for a PRIVATE Circle only current members. At most EVENT_CHECK_IN_LIST_MAX
 * people going are listed (`truncated` says more exist). The summary counts every RSVP and check-in regardless.
 */
export async function loadCheckInList(post: EventPost, viewerId: string) {
  const [rsvps, attendance, blocked, summary] = await Promise.all([
    prisma.postRsvp.findMany({
      where: { postId: post.id, user: { status: "ACTIVE" } },
      orderBy: { createdAt: "asc" },
      take: EVENT_CHECK_IN_LIST_MAX + 1,
      select: { status: true, user: { select: personSelect } },
    }),
    prisma.eventAttendance.findMany({
      where: { postId: post.id, user: { status: "ACTIVE" } },
      orderBy: { checkedInAt: "asc" },
      take: EVENT_CHECK_IN_LIST_MAX,
      select: { walkIn: true, user: { select: personSelect } },
    }),
    getBlockedEitherWayIds(viewerId),
    loadAttendanceSummary(post.id),
  ]);
  const truncated = rsvps.length > EVENT_CHECK_IN_LIST_MAX;
  const replies = rsvps.slice(0, EVENT_CHECK_IN_LIST_MAX);
  const goingUsers = replies.map((r) => r.user);
  const attendedIds = new Set(attendance.map((a) => a.user.id));
  const goingIds = new Set(goingUsers.map((u) => u.id));
  const visible = new Set(
    await filterCircleContentViewers(post.circle.id, [
      ...new Set([...goingUsers.map((u) => u.id), ...attendance.map((a) => a.user.id)]),
    ]),
  );
  const keep = (id: string) => visible.has(id) && !blocked.has(id);
  const byName = (a: CheckInPerson, b: CheckInPerson) =>
    (a.name ?? a.username ?? "").localeCompare(b.name ?? b.username ?? "");

  const replied: CheckInPerson[] = replies
    .filter((r) => keep(r.user.id))
    .map((r) => ({
      userId: r.user.id,
      name: r.user.name,
      username: r.user.username,
      avatarUrl: r.user.avatarUrl,
      rsvp: r.status,
      attended: attendedIds.has(r.user.id),
      walkIn: false,
    }))
    .sort((a, b) => (a.rsvp === b.rsvp ? byName(a, b) : a.rsvp === "GOING" ? -1 : 1));
  const walkIns: CheckInPerson[] = attendance
    .filter((a) => !goingIds.has(a.user.id) && keep(a.user.id))
    .map((a) => ({
      userId: a.user.id,
      name: a.user.name,
      username: a.user.username,
      avatarUrl: a.user.avatarUrl,
      rsvp: null,
      attended: true,
      walkIn: a.walkIn,
    }))
    .sort(byName);
  return { people: [...replied, ...walkIns], summary, truncated };
}

/** A member offered by "Add a walk-in". */
export type WalkInCandidate = { userId: string; name: string | null; username: string | null; avatarUrl: string | null };

/**
 * "Add a walk-in": current ACTIVE members of the Circle who can open the event's channel, whose name or @username
 * contains `query`, not already checked in, not going (they're on the list already), not blocked either way with the
 * organizer; at most EVENT_WALK_IN_SEARCH_LIMIT.
 */
export async function searchWalkInCandidates(post: EventPost, viewerId: string, query: string): Promise<WalkInCandidate[]> {
  const [members, blocked, attended, going] = await Promise.all([
    prisma.circleMembership.findMany({
      where: {
        circleId: post.circle.id,
        user: {
          status: "ACTIVE",
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { username: { contains: query, mode: "insensitive" } },
          ],
        },
      },
      orderBy: { joinedAt: "desc" },
      take: 60,
      select: { user: { select: personSelect } },
    }),
    getBlockedEitherWayIds(viewerId),
    prisma.eventAttendance.findMany({ where: { postId: post.id }, select: { userId: true } }),
    prisma.postRsvp.findMany({ where: { postId: post.id }, select: { userId: true } }),
  ]);
  const skip = new Set([...attended.map((a) => a.userId), ...going.map((r) => r.userId)]);
  const candidates = members.map((m) => m.user).filter((u) => !blocked.has(u.id) && !skip.has(u.id));
  const audience = await eventAudience(post, candidates.map((u) => u.id));
  return candidates
    .filter((u) => audience.has(u.id))
    .slice(0, EVENT_WALK_IN_SEARCH_LIMIT)
    .map((u) => ({ userId: u.id, name: u.name, username: u.username, avatarUrl: u.avatarUrl }));
}

/**
 * The event itself, or every date of its repeating series (same Circle, same author, published, oldest first, at most
 * EVENT_EXPORT_MAX_OCCURRENCES): the posts an export covers. Every date of a series has the same author, Circle and
 * channel, so whoever organizes one date organizes them all.
 */
export async function exportOccurrencePosts(post: EventPost, series: boolean) {
  const select = { id: true, content: true, eventAt: true, eventCancelledAt: true } as const;
  if (!series || !post.eventSeriesId) {
    return [{ id: post.id, content: post.content, eventAt: post.eventAt, eventCancelledAt: post.eventCancelledAt }];
  }
  const rows = await prisma.post.findMany({
    where: {
      eventSeriesId: post.eventSeriesId,
      circleId: post.circle.id,
      authorId: post.authorId,
      moderationStatus: "PUBLISHED",
      eventAt: { not: null },
    },
    orderBy: [{ eventAt: "asc" }, { id: "asc" }],
    take: EVENT_EXPORT_MAX_OCCURRENCES,
    select,
  });
  return rows.map((r) => ({ ...r, eventAt: r.eventAt! }));
}

/**
 * What the CSV holds for each of `occurrences`: everyone going, checked in or bringing something, with only their name,
 * @username, RSVP time, attended or not and the items they claimed. ACTIVE accounts only, nobody blocked either way
 * with the organizer, and for a PRIVATE Circle only current members. At most EVENT_CHECK_IN_LIST_MAX people per date.
 */
export async function loadEventExport(
  circleId: string,
  occurrences: { id: string; content: string; eventAt: Date; eventCancelledAt: Date | null }[],
  viewerId: string,
): Promise<EventExportOccurrence[]> {
  const postIds = occurrences.map((o) => o.id);
  const activeUser = { status: "ACTIVE" as const };
  const [rsvps, attendance, claims, blocked] = await Promise.all([
    prisma.postRsvp.findMany({
      where: { postId: { in: postIds }, user: activeUser },
      orderBy: { createdAt: "asc" },
      select: {
        postId: true,
        status: true,
        createdAt: true,
        user: { select: { id: true, name: true, username: true } },
      },
    }),
    prisma.eventAttendance.findMany({
      where: { postId: { in: postIds }, user: activeUser },
      select: { postId: true, user: { select: { id: true, name: true, username: true } } },
    }),
    prisma.eventBringItem.findMany({
      where: { postId: { in: postIds }, claimedBy: activeUser },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { postId: true, text: true, claimedBy: { select: { id: true, name: true, username: true } } },
    }),
    getBlockedEitherWayIds(viewerId),
  ]);
  const everyone = new Set<string>();
  for (const r of rsvps) everyone.add(r.user.id);
  for (const a of attendance) everyone.add(a.user.id);
  for (const c of claims) if (c.claimedBy) everyone.add(c.claimedBy.id);
  const visible = new Set(await filterCircleContentViewers(circleId, [...everyone]));
  const keep = (id: string) => visible.has(id) && !blocked.has(id);

  return occurrences.map((occurrence) => {
    const people = new Map<string, EventExportPerson & { items: string[] }>();
    const personFor = (user: { id: string; name: string | null; username: string | null }) => {
      let person = people.get(user.id);
      if (!person) {
        person = { name: user.name, username: user.username, rsvp: null, rsvpAt: null, attended: false, items: [] };
        people.set(user.id, person);
      }
      return person;
    };
    for (const r of rsvps) {
      if (r.postId !== occurrence.id || !keep(r.user.id)) continue;
      const person = personFor(r.user);
      person.rsvp = r.status;
      person.rsvpAt = r.createdAt;
    }
    for (const a of attendance) {
      if (a.postId !== occurrence.id || !keep(a.user.id)) continue;
      personFor(a.user).attended = true;
    }
    for (const c of claims) {
      if (c.postId !== occurrence.id || !c.claimedBy || !keep(c.claimedBy.id)) continue;
      personFor(c.claimedBy).items.push(c.text);
    }
    return {
      title: eventTitle(occurrence.content),
      startAt: occurrence.eventAt,
      cancelled: !!occurrence.eventCancelledAt,
      people: [...people.values()].slice(0, EVENT_CHECK_IN_LIST_MAX),
    };
  });
}
