import { cookies, headers } from "next/headers";
import { DEVICE_ID_COOKIE, DEVICE_ID_HEADER } from "@/lib/device-id-constants";

export { DEVICE_ID_COOKIE, DEVICE_ID_HEADER };

/**
 * The current request's device id. Never null in practice — proxy.ts's
 * matcher covers every route that could call this — but callers should
 * still treat a missing id as "unknown device" rather than throwing, in
 * case proxy.ts's matcher and a caller's route ever drift.
 */
export async function getDeviceId(): Promise<string | null> {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(DEVICE_ID_COOKIE)?.value;
  if (fromCookie) return fromCookie;

  const h = await headers();
  return h.get(DEVICE_ID_HEADER);
}

/**
 * Short, human-readable device description — "Chrome on Windows", "Safari
 * on iPhone" — shown in verification emails so the code actually helps
 * someone recognize (or reject) the device it's for. Best-effort string
 * matching, not a real UA-parsing library: good enough for a label, never
 * used for a security decision.
 */
export function labelFromUserAgent(ua: string): string {
  if (!ua) return "Unknown device";

  const os = (() => {
    if (/android/i.test(ua)) return "Android";
    if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
    if (/windows/i.test(ua)) return "Windows";
    if (/mac os x/i.test(ua)) return "Mac";
    if (/linux/i.test(ua)) return "Linux";
    return null;
  })();

  // The native Android/iOS wrapper is a thin WebView over yukon3t.com (see
  // CLAUDE.md) — Capacitor's default UA carries no distinguishing marker of
  // its own, but "; wv)" is Android's standard WebView UA token, and iOS
  // WebViews are indistinguishable from mobile Safari by UA alone, so this
  // only reliably catches the Android app case.
  if (/; wv\)/i.test(ua)) {
    return os ? `YuKon3t app on ${os}` : "YuKon3t app";
  }

  const browser = (() => {
    if (/edg\//i.test(ua)) return "Edge";
    if (/chrome\//i.test(ua) && !/chromium/i.test(ua)) return "Chrome";
    if (/firefox\//i.test(ua)) return "Firefox";
    if (/version\/.*safari/i.test(ua)) return "Safari";
    if (/safari/i.test(ua)) return "Safari";
    return null;
  })();

  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return `A device running ${os}`;
  return "Unknown device";
}

export async function getDeviceLabel(): Promise<string> {
  const h = await headers();
  return labelFromUserAgent(h.get("user-agent") ?? "");
}
