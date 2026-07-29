import { prisma } from "@/lib/prisma";
import type { TrustBand } from "@/generated/prisma/enums";

const DAY_MS = 24 * 60 * 60 * 1000;

export function bandFromScore(score: number): TrustBand {
  if (score >= 70) return "TRUSTED";
  if (score >= 30) return "ESTABLISHED";
  return "NEW";
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

  const upheldReports = user._count.reportsReceived;
  score -= Math.min(50, upheldReports * 15);

  score = Math.max(0, Math.min(100, score));

  await prisma.user.update({
    where: { id: userId },
    data: { trustScore: score, trustBand: bandFromScore(score) },
  });
}
