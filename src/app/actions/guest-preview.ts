"use server";

import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";
import { isBotSubmission } from "@/lib/bot-protection";
import { passesBotGate } from "@/lib/bot-gate";
import { captchaErrorCode } from "@/lib/turnstile-shared";
import { track } from "@/lib/analytics";
import { clearHiddenUnlockCookie } from "@/lib/hidden-chats";
import { isGuestPreviewEnabled, safeGuestExitDestination, sanitizeGuestRef } from "@/lib/guest-preview";
import { ensureGuestPreviewUser, issueGuestSessionCookie } from "@/lib/guest-preview-server";

// Guest preview ("Explore YuKon3t as a guest", /try). Rules: src/lib/guest-preview.ts. Both actions are public (no
// requireUser): one starts a read-only guest session, the other ends it on the way to sign-up / sign-in.

function tryPageWithError(code: string, ref: string | null): never {
  redirect(`/try?error=${code}${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`);
}

/** The /try button. Starts this visitor's own guest session and opens Home. Never replaces a real member's session. */
export async function startGuestPreview(formData: FormData) {
  const ref = sanitizeGuestRef(formData.get("ref"));
  if (!isGuestPreviewEnabled()) tryPageWithError("unavailable", ref);

  const session = await auth();
  // Already signed in (a member, or a guest whose session is still live): nothing to start.
  if (session?.user?.id) redirect("/home");

  if (isBotSubmission(formData)) tryPageWithError("rate_limited", ref);
  const ip = await getClientIp();
  const botCheck = await passesBotGate(formData, ip, "startGuestPreview");
  if (!botCheck.ok) tryPageWithError(captchaErrorCode(botCheck.reason), ref);
  const [perIp, global] = await Promise.all([
    checkRateLimit("guestPreviewStart", `guest:${ip}`),
    checkRateLimit("guestPreviewStartGlobal", "guest:all"),
  ]);
  if (!perIp || !global) tryPageWithError("rate_limited", ref);

  const guestId = await ensureGuestPreviewUser();
  if (!guestId) tryPageWithError("unavailable", ref);

  await issueGuestSessionCookie(guestId);
  await track("GUEST_PREVIEW_STARTED", guestId, ref ? { ref } : undefined);
  redirect("/home");
}

/**
 * The guest sheet's / banner's "Sign up" and "Sign in": ends the guest session (so the sign-up and sign-in pages start
 * clean) and goes there. For anyone who isn't a guest it only navigates; it never signs a member out.
 */
export async function leaveGuestPreview(formData: FormData) {
  const destination = safeGuestExitDestination(formData.get("to"));
  const session = await auth();
  if (session?.user?.isGuest) {
    await clearHiddenUnlockCookie();
    await signOut({ redirectTo: destination });
  }
  redirect(destination);
}
