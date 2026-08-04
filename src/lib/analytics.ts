import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export type AnalyticsEventType =
  | "SIGN_UP"
  | "SIGN_IN"
  | "POST_CREATED"
  | "CONNECTION_REQUESTED"
  | "CONNECTION_ACCEPTED"
  | "MESSAGE_SENT"
  | "CALL_STARTED"
  | "CIRCLE_JOINED"
  | "CIRCLE_CREATED";

/**
 * First-party, privacy-minimal product-usage log — a handful of key
 * lifecycle events, not a full session/click tracker. Never throws: a
 * logging failure must never break the feature action it's attached to.
 */
export async function track(
  type: AnalyticsEventType,
  userId?: string | null,
  metadata?: Prisma.InputJsonValue,
) {
  try {
    await prisma.analyticsEvent.create({
      data: { type, userId: userId ?? undefined, metadata },
    });
  } catch {
    // Swallow — analytics is observational, never load-bearing.
  }
}
