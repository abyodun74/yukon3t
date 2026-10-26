"use client";

import type { PostHog } from "posthog-js";
import { disablePostHogGeoIp } from "@/lib/posthog-geoip";
import { getNetworkQuality, onNetworkQualityChange } from "@/lib/network-quality-client";

// Opt-in until configured, same pattern as GTM/Clarity/R2 elsewhere in this
// app (see analytics-scripts.tsx) — deploying without these env vars is a
// no-op, never a broken/half-initialized SDK.
const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST;

// posthog-js is loaded with import(), not statically: it was ~90KB gzipped
// of every page's first-load JavaScript (measured 2026-10-26: every route's
// initial JS went from ~522KB to ~431KB gzipped), downloaded and parsed before the
// app could respond, for something that doesn't need to run until the page
// is idle (see PostHogProvider). identify/pageview calls made before then
// wait on `loaded` and run in order once it resolves — they don't start the
// download themselves, initPostHog does.
let loading: Promise<PostHog | null> | null = null;
let resolveLoaded: (posthog: PostHog) => void = () => {};
const loaded = new Promise<PostHog>((resolve) => {
  resolveLoaded = resolve;
});

function loadPostHog(): Promise<PostHog | null> {
  if (!KEY || !HOST) return Promise.resolve(null);
  loading ??= import("posthog-js")
    .then(({ default: posthog }) => {
      init(posthog);
      resolveLoaded(posthog);
      return posthog;
    })
    .catch(() => {
      // A failed chunk download (offline, a deploy in between) just means no
      // analytics this page load; the next call tries again.
      loading = null;
      return null;
    });
  return loading;
}

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
  void loadPostHog();
}

function init(posthog: PostHog) {
  // On a slow connection or with Data saver on, no session recording: the
  // recorder is another script download and a recording is a steady upload,
  // competing with the app itself for a link that has little to spare.
  // Events and pageviews are still sent. Decided when the SDK starts, and a
  // recording already running stops if the connection turns slow later (it
  // doesn't restart by itself on this page load once things improve).
  const lowData = getNetworkQuality() === "slow";
  onNetworkQualityChange(() => {
    if (getNetworkQuality() === "slow" && posthog.sessionRecordingStarted()) posthog.stopSessionRecording();
  });
  posthog.init(KEY!, {
    api_host: HOST,
    // "Loose" is Next.js's own recommended default for the App Router:
    // capture pageviews itself on route change instead of relying on
    // posthog-js's own history-API patching, which can double-count or
    // miss a Next.js client-side transition.
    capture_pageview: false,
    person_profiles: "identified_only",
    // No IP-derived location: every event (pageviews, $identify, replay
    // $snapshot batches) carries $geoip_disable so PostHog skips GeoIP
    // enrichment. Set in init, so nothing is ever sent without it. See
    // posthog-geoip.ts for why there's no `ip: false` here.
    before_send: disablePostHogGeoIp,
    disable_session_recording: lowData,
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
  void loaded.then((posthog) => posthog.identify(userId));
}

/** One manual `$pageview` (see PostHogProvider). */
export function capturePostHogPageview(pathname: string) {
  if (!KEY || !HOST) return;
  void loaded.then((posthog) => posthog.capture("$pageview", { $current_url: pathname }));
}

/**
 * Clears the identified user so a shared/public device's next signed-in
 * session doesn't inherit the previous account's identity — call on sign
 * out (nav.tsx's handleSignOut), same reasoning as that function's existing
 * FCM-token and draft-storage cleanup.
 */
export async function resetPostHog(): Promise<void> {
  // The identity is persisted on the device, so even a sign-out before the
  // SDK got loaded on this page has to load it to clear that — but never
  // holds the sign-out up for more than 3s on a slow link waiting for it.
  const posthog = await Promise.race([
    loadPostHog(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000)),
  ]);
  posthog?.reset();
}
