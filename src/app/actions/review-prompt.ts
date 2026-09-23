"use server";

import { prisma } from "@/lib/prisma";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { track } from "@/lib/analytics";
import {
  isEligibleForReviewPrompt,
  REVIEW_PROMPT_MAX_ASKS,
} from "@/lib/review-prompt";

/** Cheap existence check, not a count — the gate only needs "have they done anything at all," not how much. */
async function hasMeaningfulActivity(userId: string): Promise<boolean> {
  const [post, message, membership] = await Promise.all([
    prisma.post.findFirst({ where: { authorId: userId }, select: { id: true } }),
    prisma.message.findFirst({ where: { senderId: userId }, select: { id: true } }),
    prisma.circleMembership.findFirst({ where: { userId }, select: { id: true } }),
  ]);
  return Boolean(post || message || membership);
}

/**
 * Called once per app-open (see review-prompt-gate.tsx) to decide whether
 * to show the "How's the yukon3t app?" modal right now. Read-only — the
 * "shown" side-effect (analytics only; no DB write needed just to display
 * it) is recorded by the caller once it actually renders the modal, not
 * here, so a component that calls this and decides not to render for its
 * own reasons doesn't skew the "how many times has this been shown" signal.
 */
export async function checkReviewPromptEligibility(): Promise<{ eligible: boolean }> {
  const user = await requireVerifiedUser();
  // Cheapest possible bail-out first — skips the 3-table activity check
  // entirely for the common case (already answered, or already asked out),
  // using fields requireVerifiedUser already fetched (no extra query).
  if (user.reviewPromptStatus !== "PENDING" || user.reviewPromptAskCount >= REVIEW_PROMPT_MAX_ASKS) {
    return { eligible: false };
  }
  const activity = await hasMeaningfulActivity(user.id);
  const eligible = isEligibleForReviewPrompt({
    accountCreatedAt: user.createdAt,
    reviewPromptStatus: user.reviewPromptStatus,
    reviewPromptAskCount: user.reviewPromptAskCount,
    reviewPromptLastAskedAt: user.reviewPromptLastAskedAt,
    hasMeaningfulActivity: activity,
  });
  return { eligible };
}

/** The modal actually rendered — separate from eligibility so "shown" and "eligible-but-not-shown" stay distinguishable in the funnel. */
export async function recordReviewPromptShown() {
  const user = await requireVerifiedUser();
  await track("REVIEW_PROMPT_SHOWN", user.id);
  return { error: null };
}

/**
 * "I love it" -> LOVED (terminal; the gate then triggers the native store
 * review popup client-side — see in-app-review.ts, never from here, since
 * that has to run on the device, not the server). "Could be better" ->
 * DECLINED (terminal; the gate then shows the private feedback form
 * instead of the native popup, so a lukewarm/negative signal never reaches
 * a public app-store review). "Maybe later" -> stays PENDING, just snoozes
 * (see REVIEW_PROMPT_SNOOZE_DAYS/MAX_ASKS in lib/review-prompt.ts).
 */
export async function recordReviewPromptChoice(choice: "LOVE" | "MEH" | "LATER") {
  const user = await requireVerifiedUser();
  // Already answered (a double-submit, or a stale client after a previous
  // tab already recorded a choice) — treat as a no-op success rather than
  // silently overwriting a terminal decision.
  if (user.reviewPromptStatus !== "PENDING") {
    return { error: null };
  }

  if (choice === "LOVE") {
    await prisma.user.update({ where: { id: user.id }, data: { reviewPromptStatus: "LOVED" } });
    await track("REVIEW_PROMPT_LOVED", user.id);
    return { error: null };
  }
  if (choice === "MEH") {
    await prisma.user.update({ where: { id: user.id }, data: { reviewPromptStatus: "DECLINED" } });
    await track("REVIEW_PROMPT_DECLINED", user.id);
    return { error: null };
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { reviewPromptAskCount: { increment: 1 }, reviewPromptLastAskedAt: new Date() },
  });
  await track("REVIEW_PROMPT_SNOOZED", user.id);
  return { error: null };
}

/**
 * The "Could be better" path's actual feedback text — private to admins
 * (see /admin/feedback), never moderated the way public content is: this
 * is someone telling the team something, not posting for other members to
 * see, so the moderation gate that protects other users from harmful
 * public content doesn't apply here.
 */
export async function submitAppFeedback(formData: FormData) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("appFeedback", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const content = String(formData.get("content") ?? "").trim();
  if (!content || content.length > 2000) {
    return { error: "invalid" as const };
  }

  await prisma.appFeedback.create({ data: { userId: user.id, content } });

  const admins = await prisma.user.findMany({
    where: { isAdmin: true, id: { not: user.id } },
    select: { id: true },
  });
  if (admins.length > 0) {
    await prisma.notification.createMany({
      data: admins.map((admin) => ({
        recipientId: admin.id,
        actorId: user.id,
        type: "APP_FEEDBACK_SUBMITTED" as const,
        message: content.length > 140 ? `${content.slice(0, 140)}…` : content,
      })),
    });
  }

  return { error: null };
}
