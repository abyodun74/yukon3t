import { cache } from "react";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import {
  HIDDEN_UNLOCK_COOKIE,
  HIDDEN_UNLOCK_MAX_AGE_SECONDS,
  encodeHiddenUnlockToken,
  verifyHiddenUnlockToken,
} from "@/lib/hidden-unlock-token";
import {
  HIDDEN_CALLER_NAME,
  hiddenPinLockoutUntil,
  hiddenPinAttemptsLeft,
  isHiddenPinLocked,
  type HiddenState,
} from "@/lib/hidden-chats-rules";

/**
 * Hidden chats: a per-user, one-sided, PIN-locked area (ConversationMember.hiddenAt). This file is the server half:
 * which conversations and 1:1 peers a user has hidden, the unlock cookie, and the PIN check with its lockout. The rules
 * themselves are in hidden-chats-rules.ts.
 *
 * Every surface that lists conversations, peers or message notifications to a user must filter through
 * getHiddenState / getHiddenPeerIds; the list of surfaces covered is in CLAUDE.md.
 */

/**
 * The conversations this user has hidden and, for each hidden 1:1, the other person. One query on the
 * (userId, hiddenAt) index that comes back empty for nearly everyone, memoised per request: the badge-count route and
 * most pages ask more than once.
 */
export const getHiddenState = cache(async (userId: string): Promise<HiddenState> => {
  const rows = await prisma.conversationMember.findMany({
    where: { userId, hiddenAt: { not: null } },
    select: {
      conversationId: true,
      conversation: {
        select: {
          isGroup: true,
          // A 1:1 has exactly one other member; `take` keeps a hidden group from loading its whole member list here.
          members: { where: { userId: { not: userId } }, select: { userId: true }, take: 1 },
        },
      },
    },
  });
  const peerIds = new Set<string>();
  for (const row of rows) {
    const peer = row.conversation.isGroup ? undefined : row.conversation.members[0];
    if (peer) peerIds.add(peer.userId);
  }
  return { conversationIds: rows.map((r) => r.conversationId), peerIds: [...peerIds] };
});

/** The other member of each hidden 1:1 chat. Hidden groups hide the group, not the people in it. */
export async function getHiddenPeerIds(userId: string): Promise<string[]> {
  return (await getHiddenState(userId)).peerIds;
}

/** Which of `userIds` have this conversation hidden: the recipient split afterMessageSent and the screenshot notice use. */
export async function getMembersHidingConversation(conversationId: string, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await prisma.conversationMember.findMany({
    where: { conversationId, userId: { in: userIds }, hiddenAt: { not: null } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

// ---------- Unlock cookie ----------

export async function issueHiddenUnlockCookie(userId: string) {
  const token = await encodeHiddenUnlockToken(userId, process.env.AUTH_SECRET!);
  const cookieStore = await cookies();
  cookieStore.set(HIDDEN_UNLOCK_COOKIE, token, {
    httpOnly: true,
    secure: process.env.AUTH_URL?.startsWith("https://") ?? true,
    sameSite: "strict",
    path: "/",
    maxAge: HIDDEN_UNLOCK_MAX_AGE_SECONDS,
  });
}

export async function clearHiddenUnlockCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(HIDDEN_UNLOCK_COOKIE);
}

export async function isHiddenUnlocked(userId: string): Promise<boolean> {
  const cookieStore = await cookies();
  return verifyHiddenUnlockToken(cookieStore.get(HIDDEN_UNLOCK_COOKIE)?.value, userId, process.env.AUTH_SECRET!);
}

/** For a caller that already holds the membership row: hidden for this member, and they haven't entered the PIN. */
export async function isMembershipLocked(membership: { hiddenAt: Date | null }, userId: string): Promise<boolean> {
  return membership.hiddenAt !== null && !(await isHiddenUnlocked(userId));
}

/** Same, looked up by conversation id. False for a non-member: the caller's own membership check decides that case. */
export async function isConversationLocked(userId: string, conversationId: string): Promise<boolean> {
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { hiddenAt: true },
  });
  return membership ? isMembershipLocked(membership, userId) : false;
}

// ---------- PIN ----------

/**
 * The PIN hash and lockout counters. These columns are omitted from every other User query (see src/lib/prisma.ts),
 * so they have to be asked for here by name. Never return this object, or anything but a boolean derived from it, to a
 * browser.
 */
export async function getHiddenPinState(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, hiddenChatsPinHash: true, hiddenPinFailedAttempts: true, hiddenPinLockedUntil: true },
  });
}

export function hashHiddenPin(pin: string) {
  return hashPassword(pin);
}

export type HiddenSecretCheck =
  | { ok: true }
  | { ok: false; error: "locked"; lockedUntil: number | null }
  | { ok: false; error: "wrong"; attemptsLeft: number };

/**
 * Runs one guess at a secret that guards the hidden area (the PIN, or the account password when resetting it) under
 * the database lockout. The attempt is counted BEFORE the secret is checked, in an update that only succeeds if nobody
 * else counted one in between, so a burst of parallel guesses gets no more tries than a patient one: the losers of that
 * race are refused without their guess being evaluated. A correct guess then clears the count.
 */
export async function checkHiddenSecret(
  user: { id: string; hiddenPinFailedAttempts: number; hiddenPinLockedUntil: Date | null },
  verify: () => Promise<boolean>,
): Promise<HiddenSecretCheck> {
  const now = new Date();
  if (isHiddenPinLocked(user.hiddenPinLockedUntil, now)) {
    return { ok: false, error: "locked", lockedUntil: user.hiddenPinLockedUntil!.getTime() };
  }

  const attempts = user.hiddenPinFailedAttempts + 1;
  const lockUntil = hiddenPinLockoutUntil(attempts, now);
  const reserved = await prisma.user.updateMany({
    where: {
      id: user.id,
      hiddenPinFailedAttempts: user.hiddenPinFailedAttempts,
      OR: [{ hiddenPinLockedUntil: null }, { hiddenPinLockedUntil: { lte: now } }],
    },
    data: { hiddenPinFailedAttempts: attempts, hiddenPinLockedUntil: lockUntil },
  });
  if (reserved.count === 0) {
    return { ok: false, error: "locked", lockedUntil: null };
  }

  if (await verify()) {
    await prisma.user.update({
      where: { id: user.id },
      data: { hiddenPinFailedAttempts: 0, hiddenPinLockedUntil: null },
    });
    return { ok: true };
  }
  if (lockUntil) return { ok: false, error: "locked", lockedUntil: lockUntil.getTime() };
  return { ok: false, error: "wrong", attemptsLeft: hiddenPinAttemptsLeft(attempts) };
}

export function checkHiddenPin(
  user: { id: string; hiddenChatsPinHash: string | null; hiddenPinFailedAttempts: number; hiddenPinLockedUntil: Date | null },
  pin: string,
) {
  return checkHiddenSecret(user, async () =>
    user.hiddenChatsPinHash ? verifyPassword(pin, user.hiddenChatsPinHash) : false,
  );
}

// ---------- Calls ----------

/**
 * The name to announce an incoming call under, to `recipientId`: "Private call" when the caller is someone whose 1:1
 * chat the recipient has hidden, otherwise the name unchanged. Used for every ring payload (web push, FCM, VoIP) and
 * for getIncomingCall, so the lock screen and the in-app banner never name a hidden peer.
 */
export async function maskHiddenCallerName(
  recipientId: string,
  callerId: string,
  name: string | null,
): Promise<string | null> {
  return (await getHiddenPeerIds(recipientId)).includes(callerId) ? HIDDEN_CALLER_NAME : name;
}
