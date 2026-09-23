"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import posthog from "posthog-js";
import { initPostHog, identifyPostHogUser } from "@/lib/posthog-client";

/**
 * Mounted once in the root layout, unconditionally — inits PostHog
 * regardless of sign-in state (so the signed-out marketing/landing pages
 * are covered too), and identifies the account once `userId` is known
 * (passed down from the server-rendered session, same prop-drilling
 * pattern as FcmTokenBridge/ShareTargetGate elsewhere in layout.tsx).
 * Resetting on sign-out happens in nav.tsx's handleSignOut instead of here
 * — this component only ever sees a userId going from set to unset on the
 * *next* server render (after the sign-out navigation completes), which is
 * a beat too late to stop that account's identity leaking into whatever
 * the now-signed-out page itself records first.
 */
export function PostHogProvider({ userId }: { userId?: string }) {
  const pathname = usePathname();

  useEffect(() => {
    initPostHog();
  }, []);

  useEffect(() => {
    if (userId) identifyPostHogUser(userId);
  }, [userId]);

  // Manual pageview capture (capture_pageview: false in posthog-client.ts)
  // — posthog-js's own automatic history-API patching doesn't reliably see
  // a Next.js App Router client-side transition, so this is the officially
  // recommended pattern instead: fire one $pageview per route change here.
  // Deliberately pathname-only, no query string — useSearchParams() would
  // require wrapping this (mounted directly in the root layout, mounted
  // for every single page in the app) in its own <Suspense> boundary or
  // risk de-opting the whole app's rendering; not worth it for a query
  // string PostHog's own URL-based reports don't need.
  useEffect(() => {
    if (!pathname) return;
    posthog.capture("$pageview", { $current_url: pathname });
  }, [pathname]);

  return null;
}
