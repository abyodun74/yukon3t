"use server";

import { requireUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { parseBuild, parseMarketingVersion, parsePlatform } from "@/lib/app-version";

/**
 * Registers a native Android device's FCM token against the signed-in user.
 * Called by fcm-token-bridge.tsx after the native app hands its token to the
 * web page (via a one-time ?fcm_token= launch param — see that component
 * for the full handoff, since a TWA's native code can't call an
 * authenticated API directly; it has to go through the page's own session).
 */
export async function registerFcmToken(token: string, app?: { platform?: unknown; build?: unknown; version?: unknown }) {
  const user = await requireUser();

  if (typeof token !== "string" || !token || token.length > 4096) {
    return { error: "invalid" as const };
  }

  // Which installed app this is (capacitor-bridge.tsx sends App.getInfo()), for the update-notice breakdown on
  // /admin/system. Optional: the TWA bridge and an older cached bundle send only the token, which leaves whatever was
  // stored before untouched. Malformed values are dropped, never stored.
  const platform = parsePlatform(app?.platform);
  const appInfo = platform
    ? { platform, build: parseBuild(app?.build), appVersion: parseMarketingVersion(app?.version) }
    : {};

  await prisma.fcmToken.upsert({
    where: { token },
    create: { userId: user.id, token, ...appInfo },
    // The same token re-registering under a different account (shared
    // device, new sign-in) should move to the new owner, not stay stuck.
    update: { userId: user.id, ...appInfo },
  });

  return { error: null };
}

/**
 * Unregisters this device's FCM token — called from Nav's sign-out handler,
 * before the session actually ends, so a shared/lost device stops receiving
 * pushes for an account nobody's signed into anymore. Scoped to the caller's
 * own userId (not just the token) so a stale/mismatched token client-side
 * can't be used to detach some other user's device.
 */
export async function unregisterFcmToken(token: string) {
  const user = await requireUser();
  if (!token) return { error: null };

  await prisma.fcmToken.deleteMany({ where: { token, userId: user.id } });
  return { error: null };
}
