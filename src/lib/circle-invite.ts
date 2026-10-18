/**
 * Inviting people to a PRIVATE Circle (inviteToCircle / respondToCircleInvite in actions/circles.ts). Only the
 * Circle's owner or a co-admin (MODERATOR membership) invites, and only their own accepted connections. Pure, so every
 * exclusion, the cap and the re-invite rules are unit-tested.
 */

/** People one request may invite. More than this refuses the whole request, never a subset. */
export const CIRCLE_INVITE_MAX = 50;

/** Who the owner or a co-admin may invite: `MODERATOR` membership or `Circle.createdById` — no site-admin shortcut. */
export function canInviteToCircle(
  circle: { createdById: string },
  membership: { role: string } | null,
  userId: string,
) {
  return circle.createdById === userId || membership?.role === "MODERATOR";
}

/**
 * Whether a PENDING invite still stands: its inviter must still be allowed to invite (owner, or still a co-admin of
 * this Circle — demoted, left or removed means no) and their account still ACTIVE. An invite that fails this can't be
 * accepted (acceptCircleInvite deletes it) and isn't shown to the invitee.
 */
export function canInviterStillInvite(
  circle: { createdById: string },
  inviter: { id: string; status: string } | null | undefined,
  inviterMembership: { role: string } | null | undefined,
) {
  if (!inviter || inviter.status !== "ACTIVE") return false;
  return canInviteToCircle(circle, inviterMembership ?? null, inviter.id);
}

export type CircleInviteExclusions = {
  inviterId: string;
  /** The inviter's accepted connections; nobody else can be invited. */
  connectionIds: Iterable<string>;
  /** Already in the Circle (a removed member isn't, so they can be invited again). */
  memberIds: Iterable<string>;
  /** Blocked either way with the inviter or with the Circle's owner (getBlockedEitherWayIds of each). */
  blockedIds: Iterable<string>;
  /** The inviter's hidden-chat peers (getHiddenPeerIds), like every other people list. */
  hiddenPeerIds: Iterable<string>;
  /** User.status by id; anyone missing or not ACTIVE is left out. */
  statusById: ReadonlyMap<string, string>;
};

/** `candidateIds` that may be invited, in order, each once. Shared by the action and the page's picker. */
export function eligibleCircleInvitees(candidateIds: Iterable<string>, ex: CircleInviteExclusions): string[] {
  const connections = new Set(ex.connectionIds);
  const excluded = new Set<string>([ex.inviterId, ...ex.memberIds, ...ex.blockedIds, ...ex.hiddenPeerIds]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of candidateIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (excluded.has(id) || !connections.has(id) || ex.statusById.get(id) !== "ACTIVE") continue;
    out.push(id);
  }
  return out;
}

export type CircleInviteSelection =
  | { ok: true; inviteeIds: string[]; skipped: number }
  | { ok: false; error: "too_many" };

/** The people a request names, deduplicated, capped at `max` (counted before exclusions) and filtered. */
export function selectCircleInvitees(
  requestedIds: string[],
  ex: CircleInviteExclusions,
  max = CIRCLE_INVITE_MAX,
): CircleInviteSelection {
  const unique = [...new Set(requestedIds)];
  if (unique.length > max) return { ok: false, error: "too_many" };
  const inviteeIds = eligibleCircleInvitees(unique, ex);
  return { ok: true, inviteeIds, skipped: unique.length - inviteeIds.length };
}

export type ExistingCircleInvite = { id: string; status: string };

/**
 * What re-inviting someone does to their CircleInvite row. PENDING: nothing (they're already asked). DECLINED: asked
 * again. ACCEPTED but no longer a member (left or removed): asked again. No row: a new one. ACCEPTED and still a
 * member can't reach here (members are excluded) but is a no-op too.
 */
export function circleInviteAction(
  existing: ExistingCircleInvite | null | undefined,
  isMember: boolean,
): "create" | "reset" | "noop" {
  if (!existing) return "create";
  if (existing.status === "DECLINED") return "reset";
  if (existing.status === "ACCEPTED" && !isMember) return "reset";
  return "noop";
}

/**
 * Splits eligible invitees by what happens to each. Someone with a PENDING join request is simply let in (the
 * request approved) instead of being asked back. `reset` carries the existing invite ids.
 */
export function planCircleInvites({
  inviteeIds,
  existingInvites,
  memberIds,
  pendingRequestUserIds,
}: {
  inviteeIds: string[];
  existingInvites: ReadonlyMap<string, ExistingCircleInvite>;
  memberIds: Iterable<string>;
  pendingRequestUserIds: Iterable<string>;
}) {
  const members = new Set(memberIds);
  const requesting = new Set(pendingRequestUserIds);
  const plan = {
    approveRequests: [] as string[],
    create: [] as string[],
    reset: [] as { inviteId: string; inviteeId: string }[],
    unchanged: [] as string[],
  };
  for (const inviteeId of inviteeIds) {
    if (requesting.has(inviteeId)) {
      plan.approveRequests.push(inviteeId);
      continue;
    }
    const existing = existingInvites.get(inviteeId);
    const action = circleInviteAction(existing, members.has(inviteeId));
    if (action === "create") plan.create.push(inviteeId);
    else if (action === "reset") plan.reset.push({ inviteId: existing!.id, inviteeId });
    else plan.unchanged.push(inviteeId);
  }
  return plan;
}
