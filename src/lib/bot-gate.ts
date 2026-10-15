import { cookies } from "next/headers";
import { verifyTurnstile } from "@/lib/turnstile";
import { parseAppMeta, verifyAppAttestation, type AttestResult } from "@/lib/app-attest";
import { track } from "@/lib/analytics";
import {
  APP_ATTEST_FIELD,
  APP_META_FIELD,
  ATTEST_FALLBACK_COOKIE,
  ATTEST_FALLBACK_MAX_AGE_SECONDS,
  appAttestMode,
} from "@/lib/app-attest-shared";

function isPresent(value: FormDataEntryValue | null): boolean {
  return value !== null && value !== "";
}

// Switches the app to the Turnstile button on the next attempt. Best-effort:
// the decision never depends on it.
async function setFallbackCookie() {
  try {
    const cookieStore = await cookies();
    cookieStore.set(ATTEST_FALLBACK_COOKIE, "1", {
      httpOnly: false,
      secure: process.env.AUTH_URL?.startsWith("https://") ?? true,
      sameSite: "lax",
      path: "/",
      maxAge: ATTEST_FALLBACK_MAX_AGE_SECONDS,
    });
  } catch {
    // Not in a request that can set cookies — nothing to switch.
  }
}

async function attest(formData: FormData): Promise<AttestResult> {
  try {
    return await verifyAppAttestation(formData);
  } catch {
    return { outcome: "unavailable" };
  }
}

/**
 * The bot check for every Turnstile-gated action (docs/plans/app-attestation.md).
 *
 * Trust rule: the ONLY way to pass without Turnstile is mode "enforce" AND a
 * valid, unconsumed App Check token from an allowlisted app. Every other path
 * returns exactly `verifyTurnstile(formData, ip)`. In "observe" the
 * attestation result is recorded and never changes the decision. `yk-app-meta`,
 * the user agent and the fallback cookie are untrusted and never pass anything.
 */
export async function passesBotGate(formData: FormData, ip: string | undefined, action: string): Promise<boolean> {
  const mode = appAttestMode();
  if (mode === "off") return verifyTurnstile(formData, ip);

  const hasToken = isPresent(formData.get(APP_ATTEST_FIELD));
  const hasMeta = isPresent(formData.get(APP_META_FIELD));
  if (!hasToken && !hasMeta) return verifyTurnstile(formData, ip);

  let attestation: AttestResult;
  let turnstile: boolean | undefined;
  if (mode === "enforce") {
    attestation = hasToken ? await attest(formData) : { outcome: "absent" };
    if (attestation.outcome === "ok") {
      await record(formData, action, mode, attestation, "skipped");
      return true;
    }
    if (hasToken) await setFallbackCookie();
    turnstile = await verifyTurnstile(formData, ip);
  } else {
    [attestation, turnstile] = await Promise.all([
      hasToken ? attest(formData) : Promise.resolve<AttestResult>({ outcome: "absent" }),
      verifyTurnstile(formData, ip),
    ]);
  }
  await record(formData, action, mode, attestation, turnstile ? "pass" : "fail");
  return turnstile;
}

async function record(
  formData: FormData,
  action: string,
  mode: "observe" | "enforce",
  attestation: AttestResult,
  turnstile: "pass" | "fail" | "skipped",
) {
  try {
    await track("APP_ATTESTATION", null, {
      action,
      mode,
      outcome: attestation.outcome,
      platform: attestation.platform ?? null,
      meta: parseAppMeta(formData),
      turnstile,
    });
  } catch {
    // Telemetry never affects the request.
  }
}
