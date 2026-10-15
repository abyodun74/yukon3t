import { getAppCheck } from "firebase-admin/app-check";
import { getFirebaseAdminApp, isFirebaseAdminConfigured } from "@/lib/firebase-admin";
import { captureError } from "@/lib/error-tracking";
import {
  APP_ATTEST_FIELD,
  APP_META_FIELD,
  MAX_APP_META_LENGTH,
  MAX_ATTEST_TOKEN_LENGTH,
  appAttestMode,
} from "@/lib/app-attest-shared";

// Server-only: verifies the single-use Firebase App Check token the native
// app sends in `yk-app-attest` (docs/plans/app-attestation.md). Only
// bot-gate.ts calls this; it is the only thing that may decide what a result
// means for a request.
//
// Inert until configured, same pattern as turnstile.ts:
//   NEXT_PUBLIC_APP_ATTEST_MODE                   — off | observe | enforce
//   FIREBASE_PROJECT_ID / _CLIENT_EMAIL / _PRIVATE_KEY — the service account FCM already uses
//   FIREBASE_APP_CHECK_APP_IDS                    — comma-separated Firebase App IDs allowed to attest

const VERIFY_TIMEOUT_MS = 5000;
// A JWT: three base64url segments.
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function allowedAppIds(): string[] {
  return (process.env.FIREBASE_APP_CHECK_APP_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

if (appAttestMode() !== "off" && (!isFirebaseAdminConfigured() || allowedAppIds().length === 0)) {
  // A mode without the server half is a mistake: tokens would be sent and
  // never accepted. Stay inert (everything falls to Turnstile) and say so.
  console.error(
    "[app-attest] NEXT_PUBLIC_APP_ATTEST_MODE is set but FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / " +
      "FIREBASE_PRIVATE_KEY / FIREBASE_APP_CHECK_APP_IDS are not all set — attestation is DISABLED.",
  );
}

export function isAppAttestEnabled(): boolean {
  return appAttestMode() !== "off" && isFirebaseAdminConfigured() && allowedAppIds().length > 0;
}

export type AttestOutcome =
  | "ok"
  | "absent"
  | "malformed"
  | "invalid"
  | "expired"
  | "consumed"
  | "wrong_app"
  | "unavailable"
  | "not_configured";

export type AttestPlatform = "android" | "ios" | "unknown";

export type AttestResult = { outcome: AttestOutcome; platform?: AttestPlatform };

// Firebase App IDs look like "1:1234567890:android:0a1b2c…" / "1:…:ios:…".
function platformOf(appId: string): AttestPlatform {
  const kind = appId.split(":")[2];
  return kind === "android" || kind === "ios" ? kind : "unknown";
}

class AttestTimeoutError extends Error {
  constructor() {
    super(`App Check verifyToken timed out after ${VERIFY_TIMEOUT_MS}ms`);
  }
}

// An App Check backend outage would otherwise report once per gated submit.
const UNAVAILABLE_REPORT_INTERVAL_MS = 10 * 60 * 1000;
const unavailableReports = {
  error: { lastAt: null as number | null, suppressed: 0 },
  timeout: { lastAt: null as number | null, suppressed: 0 },
};

function reportUnavailable(kind: keyof typeof unavailableReports, err: unknown) {
  const state = unavailableReports[kind];
  const now = Date.now();
  if (state.lastAt !== null && now - state.lastAt < UNAVAILABLE_REPORT_INTERVAL_MS) {
    state.suppressed += 1;
    return;
  }
  const suppressed = state.suppressed;
  state.lastAt = now;
  state.suppressed = 0;
  console.error(`[app-attest] App Check unavailable (${kind}); falling back to Turnstile`, err);
  void captureError(err, { where: "verifyAppAttestation", kind, suppressedSinceLastReport: suppressed });
}

function errorCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err && typeof err.code === "string") return err.code;
  return undefined;
}

/**
 * Verifies and consumes the `yk-app-attest` token. Never throws, and never
 * returns "ok" for anything but a valid, unconsumed token from an allowlisted
 * app. What a result means for the request is bot-gate.ts's decision.
 */
export async function verifyAppAttestation(formData: FormData): Promise<AttestResult> {
  const token = formData.get(APP_ATTEST_FIELD);
  if (token === null || token === "") return { outcome: "absent" };
  if (typeof token !== "string" || token.length > MAX_ATTEST_TOKEN_LENGTH || !JWT_SHAPE.test(token)) {
    return { outcome: "malformed" };
  }
  if (!isAppAttestEnabled()) return { outcome: "not_configured" };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const app = getFirebaseAdminApp();
    if (!app) return { outcome: "not_configured" };
    const result = await Promise.race([
      getAppCheck(app).verifyToken(token, { consume: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AttestTimeoutError()), VERIFY_TIMEOUT_MS);
      }),
    ]);
    const platform = platformOf(result.appId);
    if (!allowedAppIds().includes(result.appId)) return { outcome: "wrong_app", platform };
    if (result.alreadyConsumed !== false) return { outcome: "consumed", platform };
    return { outcome: "ok", platform };
  } catch (err) {
    if (err instanceof AttestTimeoutError) {
      reportUnavailable("timeout", err);
      return { outcome: "unavailable" };
    }
    const code = errorCode(err);
    if (code === "app-check/app-check-token-expired") return { outcome: "expired" };
    // Also what the SDK reports when it can't fetch Google's JWKS, so a
    // network failure can land here; it only changes the telemetry label.
    if (code === "app-check/invalid-argument") return { outcome: "invalid" };
    reportUnavailable("error", err);
    return { outcome: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

export type AppMeta = { p?: string; b?: string; plugin?: boolean };

const META_PLATFORM = /^(android|ios|web)$/;
const META_BUILD = /^[0-9A-Za-z._-]{1,16}$/;

/**
 * The untrusted `yk-app-meta` field: length-capped, parsed defensively, and
 * reduced to whitelisted short fields. Telemetry only — nothing may trust it.
 * Returns null when absent, "invalid" when present but unusable.
 */
export function parseAppMeta(formData: FormData): AppMeta | "invalid" | null {
  const raw = formData.get(APP_META_FIELD);
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string" || raw.length > MAX_APP_META_LENGTH) return "invalid";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "invalid";
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "invalid";
  const record = parsed as Record<string, unknown>;
  const meta: AppMeta = {};
  if (typeof record.p === "string" && META_PLATFORM.test(record.p)) meta.p = record.p;
  const build = typeof record.b === "number" && Number.isSafeInteger(record.b) ? String(record.b) : record.b;
  if (typeof build === "string" && META_BUILD.test(build)) meta.b = build;
  if (typeof record.plugin === "boolean") meta.plugin = record.plugin;
  return meta;
}
