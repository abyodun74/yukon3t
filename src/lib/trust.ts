import { prisma } from "@/lib/prisma";
import type { TrustBand } from "@/generated/prisma/enums";

const DAY_MS = 24 * 60 * 60 * 1000;

export function bandFromScore(score: number): TrustBand {
  if (score >= 70) return "TRUSTED";
  if (score >= 30) return "ESTABLISHED";
  return "NEW";
}

export function dayNumber(date: Date) {
  return Math.floor(date.getTime() / DAY_MS);
}

export type TrustSignals = {
  emailVerified: Date | null;
  phoneVerifiedAt: Date | null;
  createdAt: Date;
  bio: string | null;
  country: string | null;
  interests: string[];
  currentStreak: number;
  upheldReportCount: number;
};

/** Pure scoring logic, shared so recordActivity can score off data it already fetched instead of re-querying. */
export function computeTrustScore(signals: TrustSignals): number {
  let score = 0;
  if (signals.emailVerified) score += 30;
  // Roughly half email's weight — phone verification is an optional bonus
  // signal (Settings, post-signup), not mandatory-at-signup like email, so
  // it shouldn't dominate the score the way email does.
  if (signals.phoneVerifiedAt) score += 15;

  const accountAgeDays = (Date.now() - signals.createdAt.getTime()) / DAY_MS;
  score += Math.min(30, Math.floor(accountAgeDays / 7) * 5); // up to 30 pts over ~6 weeks

  const profileComplete = Boolean(
    signals.bio && signals.country && signals.interests.length > 0,
  );
  if (profileComplete) score += 20;

  score += Math.min(20, Math.floor(signals.currentStreak / 7) * 5); // up to 20 pts, +5 per full week of consecutive activity

  score -= Math.min(50, signals.upheldReportCount * 15);

  return Math.max(0, Math.min(100, score));
}

const trustFieldsSelect = {
  emailVerified: true,
  phoneVerifiedAt: true,
  createdAt: true,
  bio: true,
  country: true,
  interests: true,
  _count: {
    select: {
      reportsReceived: { where: { status: "RESOLVED" as const } },
    },
  },
} as const;

/**
 * Call from genuine content-creation actions (sending a message, making a
 * post) — not page views or polling. Fetches everything trust scoring needs
 * alongside the streak fields in one query, and writes both the streak and
 * the recomputed score in one update, instead of the naive "update streak,
 * then call recomputeTrustScore" which would re-read and re-write the same
 * row a second time on the hottest write paths in the app.
 */
export async function recordActivity(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastActiveAt: true, currentStreak: true, longestStreak: true, ...trustFieldsSelect },
  });
  if (!user) return;

  const today = dayNumber(new Date());
  const lastDay = user.lastActiveAt ? dayNumber(user.lastActiveAt) : null;
  if (lastDay === today) return;

  const currentStreak = lastDay === today - 1 ? user.currentStreak + 1 : 1;
  const longestStreak = Math.max(user.longestStreak, currentStreak);

  const score = computeTrustScore({
    emailVerified: user.emailVerified,
    phoneVerifiedAt: user.phoneVerifiedAt,
    createdAt: user.createdAt,
    bio: user.bio,
    country: user.country,
    interests: user.interests,
    currentStreak,
    upheldReportCount: user._count.reportsReceived,
  });

  await prisma.user.update({
    where: { id: userId },
    data: {
      currentStreak,
      longestStreak,
      lastActiveAt: new Date(),
      trustScore: score,
      trustBand: bandFromScore(score),
    },
  });
}

// Recomputes and persists a user's trust score. Originally "free, non-paid
// signals only" (phone/ID verification was descoped from the MVP over
// exactly that cost concern — see SECURITY.md) — phoneVerifiedAt is the
// first signal here that corresponds to a real per-verification cost
// (Twilio Verify), now that phone verification has been built.
export async function recomputeTrustScore(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { currentStreak: true, ...trustFieldsSelect },
  });
  if (!user) return;

  const score = computeTrustScore({
    emailVerified: user.emailVerified,
    phoneVerifiedAt: user.phoneVerifiedAt,
    createdAt: user.createdAt,
    bio: user.bio,
    country: user.country,
    interests: user.interests,
    currentStreak: user.currentStreak,
    upheldReportCount: user._count.reportsReceived,
  });

  await prisma.user.update({
    where: { id: userId },
    data: { trustScore: score, trustBand: bandFromScore(score) },
  });
}
