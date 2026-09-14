"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { registerFcmToken } from "@/app/actions/fcm";
import { FCM_TOKEN_STORAGE_KEY } from "@/lib/fcm-token-storage";

/**
 * Native-app-only wiring for the Capacitor iOS/Android build (see
 * capacitor.config.ts — the same production site, loaded in a native
 * WebView shell instead of a browser tab). Capacitor.isNativePlatform() is
 * false on the web, so this no-ops entirely for ordinary browser/PWA users
 * — the plugin imports are dynamic specifically so their code (and
 * @capacitor-firebase/messaging's Firebase JS SDK dependency) never even
 * loads into the regular web bundle.
 *
 * Unlike the Android TWA (see fcm-token-bridge.tsx), Capacitor's WebView IS
 * the app process — it shares the page's own session cookie, so the FCM
 * token can be registered by calling the server action directly instead of
 * needing a query-param handoff between two separate processes. Renders
 * unconditionally (not gated by session, unlike FcmTokenBridge) since the
 * status bar/splash handoff below should happen regardless of auth state —
 * registerFcmToken itself already requires a session and no-ops otherwise.
 */
export function CapacitorBridge() {
  const router = useRouter();
  const pathname = usePathname();
  // Set by the stable effect below to a function that (re-)runs the
  // permission-check-and-maybe-request flow. The pathname effect further
  // down calls it a second time, later in the session, once it detects the
  // app just landed on /home?onboarded=1 — the actual native listeners
  // this creates live in the stable effect's own closure (not here), so
  // this ref exists purely to let that reactive trigger reach in without
  // owning any native-listener lifecycle itself.
  const requestPermissionNowRef = useRef<(() => void) | null>(null);
  const promptedRef = useRef(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let tokenListener: { remove: () => void } | undefined;
    let actionListener: { remove: () => void } | undefined;
    let cancelled = false;

    async function setupNotifications(promptNow: boolean) {
      const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
      if (cancelled) return;

      async function register(token: string) {
        const result = await registerFcmToken(token).catch(() => null);
        // Persisted so nav.tsx's existing sign-out handler — already
        // shared with the Android TWA's token — unregisters this device
        // too, with no changes needed there.
        if (result && !result.error) {
          localStorage.setItem(FCM_TOKEN_STORAGE_KEY, token);
        }
      }

      const current = await FirebaseMessaging.checkPermissions().catch(() => null);
      let granted = current?.receive === "granted";
      // Only actually shows the OS prompt when promptNow is true — i.e.
      // right after onboarding completes (see the pathname effect below),
      // never unconditionally at plain app launch/cold start, which used
      // to be the very first thing a brand-new user saw with zero context
      // for why. A returning user whose permission is already decided
      // (granted or denied) is unaffected either way: checkPermissions()
      // already tells us there's nothing to ask.
      if (!granted && current?.receive !== "denied" && promptNow) {
        const requested = await FirebaseMessaging.requestPermissions().catch(() => null);
        granted = requested?.receive === "granted";
      }
      if (!granted || cancelled) return;

      const result = await FirebaseMessaging.getToken().catch(() => null);
      if (result?.token) await register(result.token);

      // Firebase can reissue a token later (app restore, security rotation,
      // etc.) — without this, a device would silently stop receiving pushes
      // until its next fresh install. Guarded against a stale prior
      // listener (setupNotifications can run twice in the rare case the
      // app cold-starts already on the onboarded URL — see the pathname
      // effect below) rather than assuming this is the only time it runs.
      tokenListener?.remove();
      tokenListener = await FirebaseMessaging.addListener("tokenReceived", (event) => {
        register(event.token);
      });

      // Fires when the user taps a push notification — sendFcmActivityToUser
      // (src/lib/fcm.ts) puts the notification's target path in the `url`
      // data field, matching public/sw.js's own "notificationclick" handler
      // for the web-push path. Capacitor retains this event (see the plugin's
      // `notifyListeners(..., true)` on the Android side) and replays it once
      // this listener attaches, so a cold start from a notification tap is
      // covered the same as tapping while the app is already running.
      actionListener?.remove();
      actionListener = await FirebaseMessaging.addListener(
        "notificationActionPerformed",
        (event) => {
          const url = (event.notification.data as Record<string, unknown> | undefined)?.url;
          if (typeof url === "string" && url.startsWith("/")) {
            router.push(url);
          }
        },
      );
    }

    (async () => {
      const [{ SplashScreen }, { StatusBar, Style }] = await Promise.all([
        import("@capacitor/splash-screen"),
        import("@capacitor/status-bar"),
      ]);
      if (cancelled) return;

      // AppSplash (the web intro overlay) is already painted by the time
      // this effect runs post-hydration — hiding the native splash now
      // hands off to it seamlessly instead of racing Capacitor's own
      // launchShowDuration timer (disabled via launchAutoHide: false in
      // capacitor.config.ts).
      SplashScreen.hide().catch(() => {});
      // "Dark" is Capacitor's (slightly confusing) name for light
      // status-bar content — the correct choice against yukon3t's dark
      // background, matching manifest.ts's theme_color.
      StatusBar.setStyle({ style: Style.Dark }).catch(() => {});

      // env(safe-area-inset-top) is what nav.tsx's header normally pads
      // itself with, but on Android that value is unreliable: the status-bar
      // plugin overlays the WebView using the legacy
      // SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN flag rather than a real edge-to-edge
      // WindowInsets dispatch, and Chromium's WebView doesn't always
      // populate env(safe-area-inset-*) from that flag alone — confirmed via
      // a real user's screenshot of the Collab page: the header rendered
      // flush at y:0, overlapped by the status bar, on Android specifically.
      // getInfo().height instead comes straight from Android's
      // WindowInsets.Type.statusBars() API, so it's accurate regardless of
      // that flag. Exposed as a CSS var so nav.tsx can fall back to it via
      // max(env(...), var(...)) — a no-op on iOS, where env() already works.
      StatusBar.getInfo()
        .then((info) => {
          if (info.height > 0) {
            document.documentElement.style.setProperty(
              "--status-bar-inset-top",
              `${info.height}px`,
            );
          }
        })
        .catch(() => {});

      await setupNotifications(false);
    })();

    requestPermissionNowRef.current = () => {
      setupNotifications(true);
    };

    return () => {
      cancelled = true;
      requestPermissionNowRef.current = null;
      tokenListener?.remove();
      actionListener?.remove();
    };
  }, [router]);

  // Reacts to the in-session client-side navigation that lands on
  // /home?onboarded=1 (completeOnboarding's redirect — see
  // src/app/actions/profile.ts) — the effect above only runs once, at app
  // launch, which for a brand-new user happens before onboarding, so this
  // is what actually catches the right moment to show the notification
  // prompt. usePathname() (not useSearchParams(), which needs a Suspense
  // boundary) is the reactive trigger; the query string itself is still
  // read via plain window APIs to avoid that requirement, same as
  // FcmTokenBridge. Deliberately NOT folded into the effect above — that
  // effect's dependency array must stay stable ([router] only) so its
  // token-refresh/notification-tap listeners live for the whole app
  // session; tying it to `pathname` instead would tear those listeners
  // down and fail to recreate them on every ordinary navigation.
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || promptedRef.current) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("onboarded") !== "1") return;
    promptedRef.current = true;
    url.searchParams.delete("onboarded");
    window.history.replaceState({}, "", url.toString());
    requestPermissionNowRef.current?.();
  }, [pathname]);

  return null;
}
