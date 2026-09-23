"use client";

import posthog from "posthog-js";

// Opt-in until configured, same pattern as GTM/Clarity/R2 elsewhere in this
// app (see analytics-scripts.tsx) — deploying without these env vars is a
// no-op, never a broken/half-initialized SDK.
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST;

let initialized = false;

/**
 * Idempotent — safe to call from every render of PostHogProvider (React
 * Strict Mode double-invokes effects in dev, and this app is also a
 * Capacitor WebView that can re-run bootstrap code on resume). Session
 * replay is turned on here; whether it's actually recorded also depends on
 * the PostHog project's own "Record user sessions" toggle in its dashboard
 * settings, which this can't reach — code alone can't fully enable replay
 * on a project where it's off there.
 */
export function initPostHog() {
  if (initialized || !KEY || !HOST) return;
  initialized = true;
  posthog.init(KEY, {
    api_host: HOST,
    // "Loose" is Next.js's own recommended default for the App Router:
    // capture pageviews itself on route change instead of relying on
    // posthog-js's own history-API patching, which can double-count or
    // miss a Next.js client-side transition.
    capture_pageview: false,
    person_profiles: "identified_only",
    session_recording: {
      // Two independent layers, deliberately not left at their SDK
      // defaults — this app has a real secret (end-to-end encrypted) chat
      // feature whose entire point is that not even YuKon3t's own servers
      // can read the plaintext (see src/lib/e2ee/). A third-party screen
      // recorder that captured that same decrypted text as rendered pixels
      // would quietly undermine that guarantee, so every message bubble
      // (chat-thread.tsx) carries a ph-no-capture class — blockClass below
      // is what makes that class actually block recording of that element
      // (replaced with a placeholder box) rather than just autocapture
      // events. maskTextClass is the softer sibling (text replaced with
      // asterisks, element still visible) used for anything private but
      // less critical than full E2EE chat content.
      blockClass: "ph-no-capture",
      maskTextClass: "ph-mask",
      maskAllInputs: true,
    },
  });
}

/** Ties a replay/event stream to a real account — call once per sign-in. Never PII (name/email), just the account id. */
export function identifyPostHogUser(userId: string) {
  if (!KEY || !HOST) return;
  posthog.identify(userId);
}

/**
 * Clears the identified user so a shared/public device's next signed-in
 * session doesn't inherit the previous account's identity — call on sign
 * out (nav.tsx's handleSignOut), same reasoning as that function's existing
 * FCM-token and draft-storage cleanup.
 */
export function resetPostHog() {
  if (!KEY || !HOST) return;
  posthog.reset();
}
