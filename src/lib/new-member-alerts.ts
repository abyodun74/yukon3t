import type { Prisma } from "@/generated/prisma/client";
import { decodeNotice, encodeNotice } from "@/lib/notification-notice";
import { NEW_MEMBERS_DIGEST_HREF } from "@/lib/notification-href";

// "New on YuKon3t" alerts: when someone finishes joining, people who use Discover hear about it (NEW_MEMBER_JOINED,
// bell + FCM push). Pure rules here, unit-tested; the server half is new-member-alerts-data.ts, run by the
// announce-new-members cron (every 15 minutes), never on a request path.

/** New members announced per cron run (oldest first); the rest wait for the next run. */
export const NEW_MEMBER_BATCH_SIZE = 25;
/** Recipients per run, most recently active first. Same cap as the other bulk fan-outs (EVENT_NUDGE_MAX_RECIPIENTS). */
export const NEW_MEMBER_MAX_RECIPIENTS = 500;
/** A new member is announced no sooner than this after onboarding, so they can still hide from Discover first. */
export const NEW_MEMBER_MIN_AGE_MS = 10 * 60_000;
/** ...and never later than this: an account that onboarded long ago and only now qualifies isn't "new" any more. */
export const NEW_MEMBER_MAX_AGE_MS = 3 * 24 * 60 * 60_000;
/** An unread NEW_MEMBER_JOINED row younger than this absorbs later joiners into one digest row instead of a new one. */
export const NEW_MEMBER_COALESCE_MS = 12 * 60 * 60_000;
/** At most one new-member phone push per recipient per this long, however many people join. */
export const NEW_MEMBER_PUSH_COOLDOWN_MS = 12 * 60 * 60_000;
/** Recipients must have used the app this recently: an account nobody opens isn't someone who uses Discover. */
export const NEW_MEMBER_RECIPIENT_ACTIVE_MS = 30 * 24 * 60 * 60_000;

/**
 * Who may be announced: finished onboarding between NEW_MEMBER_MAX_AGE_MS and NEW_MEMBER_MIN_AGE_MS ago, not yet
 * announced, verified (email or phone, the isAccountVerified rule), ACTIVE (not suspended/banned/deactivated), and
 * visible in Discover exactly as /discover lists people (discoverable, named, not a site admin) with public posts.
 * The App Review demo account and the shared guest-preview identity (src/lib/guest-preview.ts) are never announced.
 */
export function newMemberCandidateWhere(now: Date): Prisma.UserWhereInput {
  return {
    newMemberAnnouncedAt: null,
    onboardedAt: {
      gte: new Date(now.getTime() - NEW_MEMBER_MAX_AGE_MS),
      lte: new Date(now.getTime() - NEW_MEMBER_MIN_AGE_MS),
    },
    status: "ACTIVE",
    discoverable: true,
    postsVisibility: "PUBLIC",
    name: { not: null },
    isAdmin: false,
    isAppReviewDemo: false,
    isGuestPreview: false,
    OR: [{ emailVerified: { not: null } }, { phoneVerifiedAt: { not: null } }],
  };
}

/**
 * Who hears about new members: anyone with the alert switched on (Settings -> Notifications, on by default), ACTIVE,
 * with a finished profile (the isProfileComplete rule, so they can open Discover), seen in the app within
 * NEW_MEMBER_RECIPIENT_ACTIVE_MS. Not the App Review demo account, nor the guest-preview identity. Blocks are applied per pair by planNewMemberAlerts.
 */
export function newMemberRecipientWhere(now: Date): Prisma.UserWhereInput {
  return {
    newMemberAlerts: true,
    status: "ACTIVE",
    isAppReviewDemo: false,
    isGuestPreview: false,
    name: { not: null },
    country: { not: null },
    interests: { isEmpty: false },
    lastSeenAt: { gte: new Date(now.getTime() - NEW_MEMBER_RECIPIENT_ACTIVE_MS) },
  };
}

/** The key planNewMemberAlerts looks blocks up by: either direction of a Block row between the two. */
export function blockPairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** The messageData of a NEW_MEMBER_JOINED row: null for one person, a new_members notice for a digest. */
export function newMemberMessageData(others: number): string | null {
  return others > 0 ? encodeNotice({ kind: "new_members", others }) : null;
}

/** How many people besides the actor an existing NEW_MEMBER_JOINED row already counts. */
export function newMemberOthersIn(messageData: string | null | undefined): number {
  const notice = decodeNotice(messageData);
  return notice?.kind === "new_members" ? notice.others : 0;
}

/** Where the row (and its push) leads: the member's profile, or Discover's newest people for a digest. */
export function newMemberHref(actorId: string, others: number): string {
  return others > 0 ? NEW_MEMBERS_DIGEST_HREF : `/u/${actorId}`;
}

export type NewMemberAlertPlan = {
  /** New bell rows. `actorId` is the newest member this recipient may see. */
  creates: { recipientId: string; actorId: string; others: number }[];
  /** Existing unread rows turned into (or grown as) a digest. */
  updates: { rowId: string; recipientId: string; actorId: string; others: number }[];
  /** Recipients to push (their row's actor/others), each past NEW_MEMBER_PUSH_COOLDOWN_MS since their last one. */
  pushes: { recipientId: string; actorId: string; others: number }[];
};

/**
 * What one run sends. `members` newest first. For each recipient: the members they may see (not themselves, no block
 * either way); none means nothing at all, so a blocked member is never hinted at, not even in a count. With an unread
 * row from the last NEW_MEMBER_COALESCE_MS (`openRows`, at most one per recipient) the members are added to it;
 * otherwise one new row. The newest visible member is the row's actor, everyone else is a count. The push follows
 * the row, only when the recipient's last one is at least NEW_MEMBER_PUSH_COOLDOWN_MS old.
 */
export function planNewMemberAlerts(input: {
  members: { id: string }[];
  recipients: { id: string; newMemberPushAt: Date | null }[];
  blockedPairs: Set<string>;
  openRows: Map<string, { id: string; messageData: string | null }>;
  now: Date;
}): NewMemberAlertPlan {
  const plan: NewMemberAlertPlan = { creates: [], updates: [], pushes: [] };
  const pushCutoff = input.now.getTime() - NEW_MEMBER_PUSH_COOLDOWN_MS;
  for (const recipient of input.recipients) {
    const visible = input.members.filter(
      (m) => m.id !== recipient.id && !input.blockedPairs.has(blockPairKey(m.id, recipient.id)),
    );
    if (visible.length === 0) continue;
    const actorId = visible[0].id;
    const open = input.openRows.get(recipient.id);
    let others: number;
    if (open) {
      // The row's previous actor and the people it already counted, plus everyone new except the new actor.
      others = newMemberOthersIn(open.messageData) + visible.length;
      plan.updates.push({ rowId: open.id, recipientId: recipient.id, actorId, others });
    } else {
      others = visible.length - 1;
      plan.creates.push({ recipientId: recipient.id, actorId, others });
    }
    if (!recipient.newMemberPushAt || recipient.newMemberPushAt.getTime() <= pushCutoff) {
      plan.pushes.push({ recipientId: recipient.id, actorId, others });
    }
  }
  return plan;
}

/** Items grouped by what they say (actor + count), so each distinct row/push is written or sent once. */
export function groupByActorAndCount<T extends { actorId: string; others: number }>(items: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = `${item.actorId}:${item.others}`;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()];
}
