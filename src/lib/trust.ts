import { prisma } from "@/lib/prisma";
import type { TrustBand } from "@/generated/prisma/enums";

const DAY_MS = 24 * 60 * 60 * 1000;

export function bandFromScore(score: number): TrustBand {
  if (score >= 70) return "TRUSTED";
  if (score >= 30) return "ESTABLISHED";
  return "NEW";
}

function dayNumber(date: Date) {
  return Math.floor(date.getTime() / DAY_MS);
}

/** Call from genuine content-creation actions (sending a message, making a post) — not page views or polling. */
export async function recordActivity(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastActiveAt: true, currentStreak: true, longestStreak: true },
  });
  if (!user) return;

  const today = dayNumber(new Date());
  const lastDay = user.lastActiveAt ? dayNumber(user.lastActiveAt) : null;
  if (lastDay === today) return;

  const currentStreak = lastDay === today - 1 ? user.currentStreak + 1 : 1;
  const longestStreak = Math.max(user.longestStreak, currentStreak);

  await prisma.user.update({
    where: { id: userId },
    data: { currentStreak, longestStreak, lastActiveAt: new Date() },
  });
  await recomputeTrustScore(userId);
}

/** Recomputes and persists a user's trust score from free, non-paid signals. */
export async function recomputeTrustScore(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      emailVerified: true,
      createdAt: true,
      bio: true,
      country: true,
      interests: true,
      currentStreak: true,
      _count: {
        select: {
          reportsReceived: { where: { status: "RESOLVED" } },
        },
      },
    },
  });
  if (!user) return;

  let score = 0;
  if (user.emailVerified) score += 30;

  const accountAgeDays = (Date.now() - user.createdAt.getTime()) / DAY_MS;
  score += Math.min(30, Math.floor(accountAgeDays / 7) * 5); // up to 30 pts over ~6 weeks

  const profileComplete = Boolean(
    user.bio && user.country && user.interests.length > 0,
  );
  if (profileComplete) score += 20;

  score += Math.min(20, Math.floor(user.currentStreak / 7) * 5); // up to 20 pts, +5 per full week of consecutive activity

  const upheldReports = user._count.reportsReceived;
  score -= Math.min(50, upheldReports * 15);

  score = Math.max(0, Math.min(100, score));

  await prisma.user.update({
    where: { id: userId },
    data: { trustScore: score, trustBand: bandFromScore(score) },
  });
}
