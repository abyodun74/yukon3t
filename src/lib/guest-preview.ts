// Guest preview ("Explore YuKon3t as a guest", /try): the pure, client-safe rules. The server half (the shared guest
// row, the cookie) is src/lib/guest-preview-server.ts; the read-only enforcement is requireUser() in auth-guards.ts.
//
// Design: one shared User row flagged isGuestPreview, never signed in to with a password, link or OAuth. Every visitor
// who taps the button on /try gets their OWN session cookie for it (a normal Auth.js JWT with a `guest` claim), which
// lives at most GUEST_PREVIEW_SESSION_MAX_SECONDS from the moment it was issued (not sliding). The guest can only
// read: requireUser() refuses it, so every Server Action, upload, push registration and data export that uses it does
// too; the few read-only actions a guest needs call requireViewer() and are listed in
// src/lib/guest-preview-coverage.test.ts. Off unless GUEST_PREVIEW_ENABLED=1, and turning it off ends every guest
// session at its next request (the JWT callback in auth.ts drops the token).

/** Hard cap on one guest session, counted from when it started (activity doesn't extend it). */
export const GUEST_PREVIEW_SESSION_MAX_SECONDS = 2 * 60 * 60;

/**
 * The guest row's email: `.invalid` is reserved (RFC 2606) so no mailbox can exist, no magic link can be delivered to
 * it, and it never collides with a real address. Its only job is the unique key the guest row is upserted on.
 */
export const GUEST_PREVIEW_EMAIL = "guest-preview@yukon3t.invalid";

/** Server-read kill switch. Anything but exactly "1" is off (the default). */
export function isGuestPreviewEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.GUEST_PREVIEW_ENABLED === "1";
}

/**
 * Whether a guest session that started at `issuedAt` (seconds since epoch, the JWT's own stable `issuedAt` claim) is
 * still usable at `nowMs`. A missing or future start, or the feature being off, ends it.
 */
export function isGuestSessionLive({
  issuedAt,
  nowMs,
  enabled,
}: {
  issuedAt: number | null | undefined;
  nowMs: number;
  enabled: boolean;
}): boolean {
  if (!enabled) return false;
  if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt)) return false;
  const startedMs = issuedAt * 1000;
  // A start more than a minute in the future is not something this server issued.
  if (startedMs > nowMs + 60_000) return false;
  return nowMs - startedMs < GUEST_PREVIEW_SESSION_MAX_SECONDS * 1000;
}

/** Where the sheet's buttons may send a guest after ending the guest session. Anything else goes to /sign-up. */
export const GUEST_EXIT_DESTINATIONS = ["/sign-up", "/sign-in", "/"] as const;
export type GuestExitDestination = (typeof GUEST_EXIT_DESTINATIONS)[number];

export function safeGuestExitDestination(value: unknown): GuestExitDestination {
  return (GUEST_EXIT_DESTINATIONS as readonly unknown[]).includes(value) ? (value as GuestExitDestination) : "/sign-up";
}

/**
 * The `?ref=` a /try link carries (e.g. /try?ref=reddit), kept only as a short, plain tag for the guest-start
 * analytics row: lowercase letters, digits, dash and underscore, at most 32 characters; anything else is dropped.
 */
export function sanitizeGuestRef(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return /^[a-z0-9_-]{1,32}$/.test(v) ? v : null;
}

/** The "Give feedback" link in the guest banner: NEXT_PUBLIC_FEEDBACK_URL (http(s) or mailto) else the support inbox. */
export function guestFeedbackUrl(configured: string | undefined = process.env.NEXT_PUBLIC_FEEDBACK_URL): string {
  const v = configured?.trim();
  if (v && /^(https:\/\/|http:\/\/|mailto:)/i.test(v)) return v;
  return "mailto:support@yukon3t.com?subject=YuKon3t%20guest%20preview%20feedback";
}
