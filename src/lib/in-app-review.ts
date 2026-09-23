"use client";

import { Capacitor } from "@capacitor/core";
import { InAppReview } from "@capacitor-community/in-app-review";

/**
 * Triggers the OS's own native review popup — Android's In-App Review API
 * (Play Core) or iOS's SKStoreReviewController, whichever platform this is
 * running on. Only ever called from review-prompt-gate.tsx's "I love it"
 * path (see that file for why: the whole point of the gate in front of
 * this is that nothing else can reach it).
 *
 * Native-app-only by design, same as most of this file's siblings — a
 * plain browser tab has no OS store review concept to trigger, and
 * requestReview() would just throw there. Both platforms' own native APIs
 * are also allowed to silently no-op this (a quota Google/Apple impose,
 * not something this app controls) — there's no way to detect that from
 * here, so this always resolves normally whether or not a popup actually
 * appeared.
 */
export async function requestNativeReview(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await InAppReview.requestReview();
  } catch (err) {
    // Never blocks the gate's own flow — worst case, no popup appeared and
    // the account is already recorded as LOVED (recordReviewPromptChoice
    // runs regardless of this call's outcome), which is correct either
    // way: we're not re-asking someone who already told us they love it
    // just because the OS declined to show its own popup this time.
    console.error("[in-app-review] requestReview failed", err);
  }
}
