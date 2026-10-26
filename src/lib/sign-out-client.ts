import { signOutAction } from "@/app/actions/auth";
import { unregisterFcmToken } from "@/app/actions/fcm";
import { unregisterVoipToken } from "@/app/actions/voip";
import { FCM_TOKEN_STORAGE_KEY } from "@/lib/fcm-token-storage";
import { VOIP_TOKEN_STORAGE_KEY } from "@/lib/voip-token-storage";
import { clearDraftsForUser } from "@/lib/message-draft-storage";
import { resetPostHog } from "@/lib/posthog-client";

/**
 * Everything a sign-out does on this device, then the sign-out itself. Shared by Nav's Sign out buttons and the
 * "Update required" screen (app-update-gate.tsx), which keeps Sign out reachable while it covers the nav.
 */
export async function signOutThisDevice(userId: string | null | undefined) {
  const token = localStorage.getItem(FCM_TOKEN_STORAGE_KEY);
  if (token) {
    localStorage.removeItem(FCM_TOKEN_STORAGE_KEY);
    await unregisterFcmToken(token).catch(() => {});
  }
  // Same reasoning as the FCM cleanup just above, for the iOS VoIP push
  // path (see apns-voip.ts) — unregisterVoipToken existed already but was
  // never actually called from here, so a shared/public iOS device kept
  // ringing with the previous account's incoming calls after signing out.
  const voipToken = localStorage.getItem(VOIP_TOKEN_STORAGE_KEY);
  if (voipToken) {
    localStorage.removeItem(VOIP_TOKEN_STORAGE_KEY);
    await unregisterVoipToken(voipToken).catch(() => {});
  }
  // So a shared/public device doesn't keep this account's unsent draft
  // text around after they've signed out — see message-draft-storage.ts.
  if (userId) clearDraftsForUser(userId);
  // Same reasoning — clears the identified user from PostHog so the next
  // signed-in session on this device isn't recorded/attributed under the
  // account that just signed out.
  await resetPostHog();
  await signOutAction();
}
