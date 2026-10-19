/**
 * Who may invite people to a PRIVATE collab, whether a CollabInvite still stands, and what re-inviting does
 * (inviteToCollab / respondToCollabInvite / cancelCollabInvite in actions/collab.ts, sendCollabInvites in
 * collab-invites-server.ts). Mirrors circle-invite.ts through the shared invite-standing.ts rule. Pure, so it's
 * unit-tested; Circle-to-Collab bulk selection stays in collab-circle-invite.ts.
 */
import { holdsInviteRight, inviterStillQualifies } from "@/lib/invite-standing";

/** CollabParticipant roles that may invite besides the collab's author (who is its OWNER participant anyway). */
const COLLAB_INVITER_ROLES = ["OWNER", "MODERATOR"] as const;

/**
 * Who may invite to (and cancel invites of) a collab: its author, or an OWNER/MODERATOR participant. Deliberately not
 * isCollabAdmin, whose site-admin shortcut would send invites that could never be accepted (see
 * canCollabInviterStillInvite).
 */
export function canInviteToCollab(
  collab: { authorId: string },
  membership: { role: string } | null | undefined,
  userId: string,
) {
  return holdsInviteRight(collab.authorId, userId, membership?.role, COLLAB_INVITER_ROLES);
}

/**
 * Whether a PENDING CollabInvite still stands: its inviter is still the author or an OWNER/MODERATOR participant of
 * this collab (demoted, left or removed means no) and their account is still ACTIVE. One that fails can't be accepted
 * (respondToCollabInvite deletes it and answers invite_expired) and isn't shown to the invitee.
 */
export function canCollabInviterStillInvite(
  collab: { authorId: string },
  inviter: { id: string; status: string } | null | undefined,
  inviterMembership: { role: string } | null | undefined,
) {
  return inviterStillQualifies(collab.authorId, inviter, inviterMembership?.role, COLLAB_INVITER_ROLES);
}

/**
 * What the loaders select about an invite's inviter (collabInviterStandingSelect in collab-invites-server.ts): enough
 * for canCollabInviterStillInvite, never anything shown. Only `collab.id`'s participation counts.
 */
export type CollabInviterStanding = {
  id: string;
  status: string;
  collabParticipations: { collabId: string; role: string }[];
};

/** canCollabInviterStillInvite for an inviter loaded with their participations, picking out this collab's. */
export function collabInviteStillStands(
  collab: { id: string; authorId: string },
  inviter: CollabInviterStanding | null | undefined,
) {
  const membership = inviter?.collabParticipations.find((p) => p.collabId === collab.id);
  return canCollabInviterStillInvite(collab, inviter, membership);
}

/**
 * A PENDING invite that can no longer be accepted because its inviter no longer qualifies. Admins see it labelled in
 * the Invited list and can cancel it; re-inviting the person (individually or through a Circle) resets the same row.
 * DECLINED/ACCEPTED invites are never stale.
 */
export function isStaleCollabInvite(
  collab: { id: string; authorId: string },
  invite: { status: string; inviter: CollabInviterStanding | null | undefined },
) {
  return invite.status === "PENDING" && !collabInviteStillStands(collab, invite.inviter);
}

/** An existing CollabInvite as sendCollabInvites sees it; `stale` is isStaleCollabInvite. */
export type ExistingCollabInvite = { id: string; inviteeId: string; status: string; inviterId: string; stale: boolean };

/**
 * What inviting someone who already has a CollabInvite row does. PENDING: nothing (already asked) unless stale, then
 * asked again by the current inviter. DECLINED: asked again (an individual invite only; a Circle invite skips them,
 * see collabInviteExcludesInvitee). ACCEPTED: nothing. No row: a new one.
 */
export function collabInviteAction(existing: Pick<ExistingCollabInvite, "status" | "stale"> | null | undefined) {
  if (!existing) return "create" as const;
  if (existing.status === "PENDING") return existing.stale ? ("reset" as const) : ("noop" as const);
  if (existing.status === "DECLINED") return "reset" as const;
  return "noop" as const;
}

/**
 * Whether an existing invite keeps that person out of a Circle invite (selectCircleInvitees' existingInviteeIds) and
 * out of the page's invite pickers. Every invite does, except a stale PENDING one: nobody could ever accept it, so a
 * Circle invite re-sends it (a reset, counted against the new-invite cap like a new invite) and the pickers offer the
 * person again, instead of leaving them stuck.
 */
export function collabInviteExcludesInvitee(existing: Pick<ExistingCollabInvite, "status" | "stale">) {
  return !(existing.status === "PENDING" && existing.stale);
}

/**
 * Splits one request's invitees by what happens to each. `individualIds` are already filtered to the inviter's
 * connections who aren't participants; `circleIds` is selectCircleInvitees' output (never overlapping
 * `individualIds`). `reset` carries the row's status and inviter as read, for the guarded update.
 */
export function planCollabInvites({
  individualIds,
  circleIds,
  existing,
}: {
  individualIds: string[];
  circleIds: string[];
  existing: ReadonlyMap<string, ExistingCollabInvite>;
}) {
  const plan = {
    create: [] as string[],
    circleCreate: [] as string[],
    reset: [] as { inviteId: string; inviteeId: string; status: string; inviterId: string; fromCircle: boolean }[],
  };
  const add = (inviteeId: string, fromCircle: boolean) => {
    const row = existing.get(inviteeId);
    const action = collabInviteAction(row);
    if (action === "create") (fromCircle ? plan.circleCreate : plan.create).push(inviteeId);
    else if (action === "reset" && row) {
      plan.reset.push({ inviteId: row.id, inviteeId, status: row.status, inviterId: row.inviterId, fromCircle });
    }
  };
  for (const id of individualIds) add(id, false);
  for (const id of circleIds) add(id, true);
  return plan;
}
