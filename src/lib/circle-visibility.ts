import type { Prisma } from "@/generated/prisma/client";

/**
 * Who may know a Circle exists. Pure (no database), so the rule is unit-tested and every surface shares it.
 *
 * A PUBLIC Circle is visible to every signed-in user. A PRIVATE Circle (and a PRIVATE sub-circle, whatever its main
 * Circle is) is visible to its members only: to anyone else it does not exist. Not listed, not searchable, not
 * suggested, its page answers the same 404 as a Circle that was never created, and nothing it contains (name,
 * description, picture, member count, members, channels, posts, events, polls, comments, RSVPs, bring lists, live
 * streams) reaches them through a feed, search, profile, notification or API. A PRIVATE Circle is invite-only: the one
 * exception is a person holding a PENDING invite that still stands (loadStandingCircleInvites), who sees the Circle's
 * header (name, picture, description) and the Accept/Decline prompt on its page, and nothing inside it.
 *
 * Site admins get no shortcut here: a site admin who isn't a member sees a PRIVATE Circle only on /admin surfaces
 * (/admin/circles lists every Circle for duplicate/spam clean-up; /admin/moderation shows reported content).
 */

/** May the viewer see that the Circle exists (its page header, a link to it)? Members, or a standing invitee. */
export function canSeeCircle(
  circle: { visibility: string },
  viewer: { isMember: boolean; hasStandingInvite?: boolean },
): boolean {
  return circle.visibility !== "PRIVATE" || viewer.isMember || viewer.hasStandingInvite === true;
}

/** May the viewer see what is inside the Circle (channels, posts, events, polls, members, sub-circles)? Members only. */
export function canSeeCircleContent(circle: { visibility: string }, isMember: boolean): boolean {
  return circle.visibility !== "PRIVATE" || isMember;
}

/** Circles a viewer may have listed (Circles page, search, pickers): PUBLIC ones, and PRIVATE ones they belong to. */
export function visibleCircleWhere(viewerId: string): Prisma.CircleWhereInput {
  return { OR: [{ visibility: "PUBLIC" }, { members: { some: { userId: viewerId } } }] };
}

/**
 * The same, plus PRIVATE Circles the viewer has a PENDING invite to. A query prefilter only: whether that invite still
 * stands (its inviter can still invite) is decided by loadStandingCircleInvites, and a Circle whose invite doesn't
 * stand must then be dropped (see the sub-circle list on the Circle page).
 */
export function visibleOrInvitedCircleWhere(viewerId: string): Prisma.CircleWhereInput {
  return {
    OR: [
      { visibility: "PUBLIC" },
      { members: { some: { userId: viewerId } } },
      { invites: { some: { inviteeId: viewerId, status: "PENDING" } } },
    ],
  };
}

/** A PRIVATE Circle the viewer is not a member of: the Circles that must not exist for them. */
export function hiddenCircleWhere(viewerId: string): Prisma.CircleWhereInput {
  return { visibility: "PRIVATE", members: { none: { userId: viewerId } } };
}

/**
 * Notifications that may be shown to (and counted for) `recipientId`: drops every row about a PRIVATE Circle they are
 * not a member of, whether it points at the Circle itself, one of its channels, a post in it (or a repost/share of
 * one), or a live stream started for it. Rows written before a Circle went private, before the recipient left or was
 * removed, or by any fan-out that missed the check, stop showing at once; nothing is deleted. A row about the Circle
 * itself still shows while the recipient holds a PENDING invite to it (the CIRCLE_INVITE notice that leads to the
 * invite). CIRCLE_CREATED goes to site admins only and is kept: it is their oversight notice (it opens /admin/circles
 * for a PRIVATE Circle, see notificationHref).
 */
export function circleNotificationVisibleWhere(recipientId: string): Prisma.NotificationWhereInput {
  const hidden = hiddenCircleWhere(recipientId);
  return {
    NOT: {
      OR: [
        {
          type: { not: "CIRCLE_CREATED" },
          circle: { ...hidden, invites: { none: { inviteeId: recipientId, status: "PENDING" } } },
        },
        { channel: { circle: hidden } },
        { post: { circle: hidden } },
        { post: { repostOf: { circle: hidden } } },
        { post: { sharedPost: { circle: hidden } } },
        { liveStream: { circle: hidden } },
      ],
    },
  };
}

/**
 * Of `userIds`, the ones who may see a Circle's content: everyone for a PUBLIC Circle, only current members (by
 * `memberIds`) for a PRIVATE one. For fan-outs keyed on something other than membership (RSVPs, bring-list claims, a
 * post's author), which can name people who left the Circle, or joined while it was public.
 */
export function keepCircleContentViewers(
  circle: { visibility: string },
  userIds: readonly string[],
  memberIds: Iterable<string>,
): string[] {
  if (circle.visibility !== "PRIVATE") return [...userIds];
  const members = new Set(memberIds);
  return userIds.filter((id) => members.has(id));
}
