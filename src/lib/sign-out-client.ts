import { signOutAction } from "@/app/actions/auth";
import { unregisterFcmToken } from "@/app/actions/fcm";
import { unregisterVoipToken } from "@/app/actions/voip";
import { FCM_TOKEN_STORAGE_KEY } from "@/lib/fcm-token-storage";
import { VOIP_TOKEN_STORAGE_KEY } from "@/lib/voip-token-storage";
import { clearDraftsForUser } from "@/lib/message-draft-storage";
import { resetPostHog } from "@/lib/posthog-client";
import { removeWebPushSubscription } from "@/lib/web-push-client";
import { Capacitor } from "@capacitor/core";

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
  // Same again for a browser's Web Push subscription: it used to stay attached to the account after sign-out, so a
  // shared computer kept showing that account's messages and calls. Removed from the account and the browser; the
  // next member to sign in here gets it back without a prompt if the browser still allows notifications
  // (PushPermissionPrompt -> syncWebPushSubscription). Never in the native app, which has no Web Push subscription.
  // Capped so a stuck service worker or push service can never hold up the sign-out itself.
  if (!Capacitor.isNativePlatform()) {
    await Promise.race([removeWebPushSubscription(), new Promise((resolve) => setTimeout(resolve, 3000))]);
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
