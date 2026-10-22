import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isCircleAdmin } from "@/lib/circle-permissions";
import { canSeeCircleContent } from "@/lib/circle-visibility";
import { getBlockedEitherWayIds } from "@/lib/blocks";
import { LEAD_POST_ONLY, canViewPost, getVisiblePostsWhere } from "@/lib/post-visibility";
import {
  CIRCLE_EVENTS_PAGE_SIZE,
  canOrganizeCircleEvent,
  canUnclaimBringItem,
  eventTitle,
  nextNudgeAt,
  type CircleEventCursor,
} from "@/lib/circle-events";
import type { EventRepeatFrequency } from "@/lib/event-recurrence";

/**
 * The server half of Circle events: which of a Circle's upcoming events a viewer sees ("Coming up"), and one event's
 * organizer panel (bring list, nudge, repeat). The rules themselves are in the pure lib/circle-events.ts.
 *
 * Visibility is the Circle page's: a PRIVATE Circle's events only for members (no site-admin shortcut), a PRIVATE channel's only
 * for its allow-list and the Circle's admins, and on top of that getVisiblePostsWhere (blocked-either-way authors,
 * HIDDEN accounts, inactive authors), the same check toggleRsvp makes, so every listed event can be RSVP'd in one tap.
 */

type Viewer = { id: string; isAdmin: boolean };

/** One upcoming event as "Coming up" shows it. */
export type CircleEventView = {
  id: string;
  title: string;
  /** ISO instant. */
  eventAt: string;
  location: string | null;
  channelName: string | null;
  rsvpCount: number;
  going: boolean;
  repeating: boolean;
  /** An organizer moved it to its current time. */
  rescheduled: boolean;
};

/**
 * The viewer's access to a Circle's event list and the condition selecting the events they see, or null when they
 * may not see the Circle's posts at all. `now` is the "upcoming" boundary.
 */
export async function circleEventsScope(circleId: string, viewer: Viewer, now: Date) {
  const circle = await prisma.circle.findUnique({
    where: { id: circleId },
    select: { id: true, createdById: true, visibility: true },
  });
  if (!circle) return null;
  const membership = await prisma.circleMembership.findUnique({
    where: { userId_circleId: { userId: viewer.id, circleId } },
    select: { role: true },
  });
  // A PRIVATE Circle doesn't exist for a non-member, site admins included (lib/circle-visibility.ts).
  if (!canSeeCircleContent(circle, !!membership)) return null;
  const canModerate = isCircleAdmin(circle, membership, viewer);
  const channels = await prisma.channel.findMany({
    where: {
      circleId,
      type: "TEXT",
      ...(canModerate ? {} : { OR: [{ visibility: "PUBLIC" }, { members: { some: { userId: viewer.id } } }] }),
    },
    select: { id: true },
  });
  return { where: await circleEventsWhere(circleId, channels.map((c) => c.id), viewer.id, now) };
}

/** Upcoming, published, lead-only event posts of a Circle in the given channels, as the viewer may see them. */
export async function circleEventsWhere(
  circleId: string,
  accessibleChannelIds: readonly string[],
  viewerId: string,
  now: Date,
): Promise<Prisma.PostWhereInput> {
  return {
    AND: [
      {
        circleId,
        moderationStatus: "PUBLISHED",
        eventAt: { gt: now },
        // A cancelled event stays on the post (with its badge), not in "Coming up".
        eventCancelledAt: null,
        OR: [{ channelId: null }, { channelId: { in: [...accessibleChannelIds] } }],
      },
      LEAD_POST_ONLY,
      await getVisiblePostsWhere(viewerId),
    ],
  };
}

function cursorWhere(cursor: CircleEventCursor): Prisma.PostWhereInput {
  const at = new Date(cursor.eventAt);
  return { OR: [{ eventAt: { gt: at } }, { eventAt: at, id: { gt: cursor.id } }] };
}

/** One page of upcoming events, soonest first; `hasMore` when anything is after the last one returned. */
export async function loadCircleEventPage(
  where: Prisma.PostWhereInput,
  viewerId: string,
  cursor: CircleEventCursor | null = null,
): Promise<{ events: CircleEventView[]; hasMore: boolean }> {
  const posts = await prisma.post.findMany({
    where: cursor ? { AND: [where, cursorWhere(cursor)] } : where,
    orderBy: [{ eventAt: "asc" }, { id: "asc" }],
    take: CIRCLE_EVENTS_PAGE_SIZE + 1,
    select: {
      id: true,
      content: true,
      eventAt: true,
      eventLocation: true,
      rsvpCount: true,
      channel: { select: { name: true } },
      eventSeries: { select: { endedAt: true } },
      eventRescheduledAt: true,
    },
  });
  const page = posts.slice(0, CIRCLE_EVENTS_PAGE_SIZE);
  const mine = page.length
    ? await prisma.postRsvp.findMany({
        where: { userId: viewerId, postId: { in: page.map((p) => p.id) } },
        select: { postId: true },
      })
    : [];
  const going = new Set(mine.map((r) => r.postId));
  return {
    events: page.map((post) => ({
      id: post.id,
      title: eventTitle(post.content),
      eventAt: post.eventAt!.toISOString(),
      location: post.eventLocation,
      channelName: post.channel?.name ?? null,
      rsvpCount: post.rsvpCount,
      going: going.has(post.id),
      repeating: !!post.eventSeries && !post.eventSeries.endedAt,
      rescheduled: !!post.eventRescheduledAt,
    })),
    hasMore: posts.length > CIRCLE_EVENTS_PAGE_SIZE,
  };
}

const eventSelect = {
  id: true,
  authorId: true,
  circleId: true,
  channelId: true,
  content: true,
  eventAt: true,
  eventLocation: true,
  moderationStatus: true,
  eventNudgedAt: true,
  eventSeriesId: true,
  eventCancelledAt: true,
  eventCancelReason: true,
  eventRescheduledAt: true,
  eventRescheduleReason: true,
  eventPreviousAt: true,
  circle: { select: { id: true, slug: true, name: true, createdById: true, visibility: true } },
  channel: { select: { id: true, visibility: true } },
  eventSeries: {
    select: { id: true, frequency: true, endedAt: true, maxOccurrences: true, until: true, lastIndex: true },
  },
} satisfies Prisma.PostSelect;

export type CircleEventAccess = {
  post: Prisma.PostGetPayload<{ select: typeof eventSelect }> & {
    eventAt: Date;
    circle: NonNullable<Prisma.PostGetPayload<{ select: typeof eventSelect }>["circle"]>;
  };
  /** A Circle member who can open the event's channel: may claim items. */
  isMember: boolean;
  /** canOrganizeCircleEvent: edit the bring list, nudge, stop repeating. */
  isOrganizer: boolean;
};

/**
 * A published Circle event post and what the viewer may do with it, or null when it isn't one or the viewer may not
 * see it (canViewPost, plus a PRIVATE channel's allow-list unless they are a Circle admin): callers answer not_found.
 */
export async function loadCircleEventAccess(postId: string, viewer: Viewer): Promise<CircleEventAccess | null> {
  const post = await prisma.post.findUnique({ where: { id: postId }, select: eventSelect });
  if (!post || !post.eventAt || !post.circle || post.moderationStatus !== "PUBLISHED") return null;
  if (!(await canViewPost(postId, viewer.id))) return null;
  const membership = await prisma.circleMembership.findUnique({
    where: { userId_circleId: { userId: viewer.id, circleId: post.circle.id } },
    select: { role: true },
  });
  const isAdmin = isCircleAdmin(post.circle, membership, viewer);
  let channelOk = true;
  if (post.channel && post.channel.visibility !== "PUBLIC" && !isAdmin) {
    channelOk =
      !!membership &&
      !!(await prisma.channelMembership.findUnique({
        where: { channelId_userId: { channelId: post.channel.id, userId: viewer.id } },
        select: { id: true },
      }));
  }
  if (!channelOk) return null;
  const isMember = !!membership || post.circle.createdById === viewer.id;
  return {
    post: post as CircleEventAccess["post"],
    isMember,
    isOrganizer: canOrganizeCircleEvent({
      viewerId: viewer.id,
      authorId: post.authorId,
      circleOwnerId: post.circle.createdById,
      role: membership?.role ?? null,
    }),
  };
}

export type BringItemView = {
  id: string;
  text: string;
  claimed: boolean;
  claimedByMe: boolean;
  /** Null when unclaimed, or when the claimer is blocked either way with the viewer (then shown as just "claimed"). */
  claimerName: string | null;
  canUnclaim: boolean;
};

/** An event's bring list as the viewer sees it: only the claimer's id and name are read, never more of the user. */
export async function loadBringItems(postId: string, viewerId: string, isOrganizer: boolean): Promise<BringItemView[]> {
  const [items, blocked] = await Promise.all([
    prisma.eventBringItem.findMany({
      where: { postId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, text: true, claimedById: true, claimedBy: { select: { id: true, name: true } } },
    }),
    getBlockedEitherWayIds(viewerId),
  ]);
  return items.map((item) => ({
    id: item.id,
    text: item.text,
    claimed: !!item.claimedById,
    claimedByMe: item.claimedById === viewerId,
    claimerName:
      item.claimedBy && !blocked.has(item.claimedBy.id) ? (item.claimedBy.name ?? null) : null,
    canUnclaim: canUnclaimBringItem({ viewerId, claimedById: item.claimedById, isOrganizer }),
  }));
}

/** Everything the event panel (under the post on /post/[id], and "Event details" on its card) needs, or null when it isn't a Circle event the viewer may see. */
export type CircleEventPanelData = {
  postId: string;
  title: string;
  description: string;
  startAt: string;
  location: string | null;
  upcoming: boolean;
  /** Set when an organizer cancelled it: ISO instant and the optional reason. */
  cancelled: { at: string; reason: string | null } | null;
  /** Set when an organizer moved it: when, the optional reason and the time it was moved from (ISO instants). */
  rescheduled: { at: string; reason: string | null; from: string | null } | null;
  isMember: boolean;
  isOrganizer: boolean;
  /** ISO instant the next nudge is allowed at, when a recent one is still cooling down. */
  nextNudgeAt: string | null;
  series: { frequency: EventRepeatFrequency; active: boolean } | null;
  items: BringItemView[];
};

export async function loadCircleEventPanel(postId: string, viewer: Viewer): Promise<CircleEventPanelData | null> {
  const access = await loadCircleEventAccess(postId, viewer);
  if (!access) return null;
  const { post } = access;
  const now = new Date();
  const items = await loadBringItems(postId, viewer.id, access.isOrganizer);
  const title = eventTitle(post.content);
  return {
    postId,
    title,
    description: post.content,
    startAt: post.eventAt.toISOString(),
    location: post.eventLocation,
    upcoming: post.eventAt.getTime() > now.getTime(),
    cancelled: post.eventCancelledAt
      ? { at: post.eventCancelledAt.toISOString(), reason: post.eventCancelReason }
      : null,
    rescheduled: post.eventRescheduledAt
      ? {
          at: post.eventRescheduledAt.toISOString(),
          reason: post.eventRescheduleReason,
          from: post.eventPreviousAt?.toISOString() ?? null,
        }
      : null,
    isMember: access.isMember,
    isOrganizer: access.isOrganizer,
    nextNudgeAt: nextNudgeAt(post.eventNudgedAt, now)?.toISOString() ?? null,
    series: post.eventSeries ? { frequency: post.eventSeries.frequency, active: !post.eventSeries.endedAt } : null,
    items,
  };
}

/**
 * Who could be nudged about an event: the Circle's ACTIVE members, most recently joined first; for a PRIVATE channel
 * only its allow-list plus the Circle's owner and co-admins (the people who can open it).
 */
export async function nudgeCandidates(post: {
  circleId: string;
  circleOwnerId: string;
  channel: { id: string; visibility: string } | null;
}) {
  const members = await prisma.circleMembership.findMany({
    where: { circleId: post.circleId, user: { status: "ACTIVE" } },
    orderBy: { joinedAt: "desc" },
    select: { userId: true, role: true },
  });
  if (!post.channel || post.channel.visibility === "PUBLIC") return members.map((m) => m.userId);
  const allowed = new Set(
    (
      await prisma.channelMembership.findMany({ where: { channelId: post.channel.id }, select: { userId: true } })
    ).map((m) => m.userId),
  );
  return members
    .filter((m) => allowed.has(m.userId) || m.role !== "MEMBER" || m.userId === post.circleOwnerId)
    .map((m) => m.userId);
}
