"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { registerFcmToken } from "@/app/actions/fcm";
import { FCM_TOKEN_STORAGE_KEY } from "@/lib/fcm-token-storage";
import { getNativeAppInfo } from "@/lib/native-app-info";
import { VOIP_TOKEN_STORAGE_KEY } from "@/lib/voip-token-storage";
import { markReadByTarget } from "@/app/actions/notifications";
import { isNativePickerActive } from "@/lib/native-picker-activity";
import { unsubscribeFromPush } from "@/app/actions/push";
import { registerVoipToken } from "@/app/actions/voip";
import { installVideoCoordinator } from "@/lib/video-playback-guard";
import { reloadIfStale } from "@/lib/stale-build-client";
import { useUiText } from "@/components/ui-text";
import { QUIET_NOTIFICATION_CHANNEL_ID, QUIET_NOTIFICATION_CHANNEL_IMPORTANCE } from "@/lib/quiet-push";
import {
  ALERT_NOTIFICATION_CHANNEL_ID,
  ALERT_NOTIFICATION_CHANNEL_IMPORTANCE,
  ALERT_NOTIFICATION_CHANNEL_VISIBILITY,
} from "@/lib/alert-push";
import { PUSH_PERMISSION_CHANGED_EVENT } from "@/lib/push-permission";
import { launchUrlKey, openedUrlTarget, type OpenedUrlTarget } from "@/lib/app-links";
import { isRepeatOpen } from "@/lib/opened-url-dedupe";
import { isLandingPath, planAppReturn, shouldRefreshOnReturn } from "@/lib/app-resume";
import {
  claimLaunchUrl,
  clearPushTap,
  isAtPushTarget,
  pendingPushTap,
  rememberPushTap,
  safeInAppPath,
} from "@/lib/push-target";

function channelTexts(t: ReturnType<typeof useUiText>["t"]) {
  return {
    quiet: { name: t.birthdays.quietChannelName, description: t.birthdays.quietChannelDescription },
    alert: { name: t.pushPrompt.channelName, description: t.pushPrompt.channelDescription },
  };
}

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
 * status bar/splash handoff below should happen regardless of auth state.
 * The FCM token is registered only while someone is signed in (`userId`),
 * and again whenever that account changes.
 *
 * This component never shows the system notification prompt itself: that is
 * PushPermissionPrompt's "Turn on notifications?" sheet (and Settings ->
 * Notifications), which fire PUSH_PERMISSION_CHANGED_EVENT afterwards so the
 * phone is registered here straight away.
 */
export function CapacitorBridge({ userId }: { userId: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  // Set by the stable effect below to its notification setup (re-read the
  // permission, create the channels, register the token). The userId effect
  // further down calls it when an account signs in or switches; the native
  // listeners it creates live in the stable effect's own closure.
  const setupNotificationsRef = useRef<(() => void) | null>(null);
  const userIdRef = useRef(userId);
  // The channels' names in the reader's language, read by the stable effect below when it creates them.
  const uiText = useUiText().t;
  const channelTextRef = useRef(channelTexts(uiText));
  useEffect(() => {
    channelTextRef.current = channelTexts(uiText);
  }, [uiText]);
  // A tapped push notification or an opened link (lib/push-target.ts): once
  // the app is on its page the tap is done with. If it isn't there and the
  // app is on a landing page (Home or "/": a cold start from the tap, or a
  // stale-build reload that cut the tap's own navigation short, and the
  // plugin doesn't hand the tap to the reloaded page again), go there now.
  // Never away from a page the user has chosen since (planAppReturn,
  // lib/app-resume.ts). Runs on mount and on every navigation.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const target = pendingPushTap();
    if (!target) return;
    const location = `${window.location.pathname}${window.location.search}`;
    const plan = planAppReturn({ pendingTap: target, location, onLandingPage: isLandingPath(pathname) });
    if (plan.kind === "open") router.replace(plan.path);
    else if (isAtPushTarget(target, location)) clearPushTap();
  }, [pathname, router]);

  // Fires when the user taps a push notification — sendFcmActivityToUser
  // (src/lib/fcm.ts) puts the notification's target path in the `url` data
  // field, matching public/sw.js's own "notificationclick" handler for the
  // web-push path. Capacitor retains this event (`notifyListeners(..., true)`)
  // and replays it once this listener attaches, so a cold start from a tap is
  // covered the same as a tap while the app is running. Attached on its own,
  // straight away: it used to be attached only at the end of the permission
  // check + getToken + server registration chain below, so a cold start
  // waited on all of that (and never routed at all if any step stalled).
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let listener: { remove: () => void } | undefined;
    let urlOpenListener: { remove: () => void } | undefined;
    let cancelled = false;

    function openTapped(url: string) {
      // Recorded before navigating, so a stale-build reload that runs at this
      // same moment goes here too, and a reload onto a landing page picks the
      // tap up again (push-target.ts, app-resume.ts).
      rememberPushTap(url);
      router.push(url);
      // Tapping a push opens that one thing, so only the notifications
      // leading there are marked read — the rest stay unread until they're
      // opened too. Fire-and-forget: it must never block the navigation.
      markReadByTarget(url).catch(() => {});
    }

    (async () => {
      const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
      if (cancelled) return;
      const handle = await FirebaseMessaging.addListener("notificationActionPerformed", (event) => {
        const url = safeInAppPath((event.notification.data as Record<string, unknown> | undefined)?.url);
        if (url) openTapped(url);
      });
      if (cancelled) handle.remove();
      else listener = handle;
    })().catch(() => {});

    // A URL that opened the app (openedUrlTarget, app-links.ts): a
    // https://yukon3t.com/... link tapped in another app (iOS universal link /
    // Android App Link, once the installed build claims the domain), or the
    // yukon3t://open?path=... link of a notification the Android app builds
    // itself (the native "Missed call" one, which can't raise
    // notificationActionPerformed). Cold start: the launch URL (once per app
    // session, claimLaunchUrl); app already running (foreground or
    // background): appUrlOpen, which Android delivers through onNewIntent
    // before onResume, like a push tap. iOS also replays a cold start's
    // universal link as appUrlOpen, hence the short repeat check.
    function openLinked(url: string, target: OpenedUrlTarget) {
      if (isRepeatOpen(url, Date.now())) return;
      if (target.fromNotification) {
        openTapped(target.path);
        return;
      }
      if (target.documentLoad) {
        // An emailed sign-in link (/api/auth/callback/...) or a password
        // reset link (#token): loaded as a document in this WebView. Not
        // recorded as a push tap: the token must not sit in sessionStorage,
        // and the page this lands on is the callback's redirect, not the
        // path itself. Nothing on resume navigates, so this load is never
        // overridden.
        window.location.assign(target.path);
        return;
      }
      rememberPushTap(target.path);
      router.push(target.path);
    }
    (async () => {
      const { App } = await import("@capacitor/app");
      if (cancelled) return;
      const launch = await App.getLaunchUrl().catch(() => undefined);
      const launchTarget = openedUrlTarget(launch?.url);
      if (!cancelled && launch?.url && launchTarget && claimLaunchUrl(launchUrlKey(launch.url, launchTarget))) {
        openLinked(launch.url, launchTarget);
      }
      const handle = await App.addListener("appUrlOpen", (event) => {
        const target = openedUrlTarget(event.url);
        if (target) openLinked(event.url, target);
      });
      if (cancelled) handle.remove();
      else urlOpenListener = handle;
    })().catch(() => {});

    return () => {
      cancelled = true;
      listener?.remove();
      urlOpenListener?.remove();
    };
  }, [router]);

  // Not native-gated, unlike the rest of this component — this app-wide
  // "only one video plays at a time" rule applies equally to the plain web
  // site, so it's installed unconditionally here since CapacitorBridge is
  // already mounted once for every session regardless of platform.
  useEffect(() => {
    installVideoCoordinator();
  }, []);

  // One-time self-heal for accounts affected by a real bug (see
  // push-notifications-toggle.tsx's own comment): this native WebView does
  // support the Web Push API, so tapping that toggle from inside the app
  // used to leave a stray PushSubscription row behind, duplicate to the
  // FCM token this same effect registers below — startCall then sent to
  // both, producing two "Incoming call" notifications for one ring on both
  // Android and iOS. The toggle is hidden natively now (prevents this
  // going forward), but doesn't undo a subscription already created before
  // that fix shipped — this does, unconditionally, every native launch,
  // since a native app should never legitimately have one of its own.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    (async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (!subscription) return;
        await unsubscribeFromPush(subscription.endpoint).catch(() => {});
        await subscription.unsubscribe().catch(() => {});
      } catch {
        // Best-effort — nothing actionable if the WebView's own service
        // worker/push APIs misbehave here.
      }
    })();
  }, []);

  // iOS-only: registers this device's PushKit VoIP token, the counterpart
  // to the FCM token registration below — see src/lib/native-callkit.ts and
  // NativeCallKitPlugin.swift for why this needs its own separate plugin
  // instead of reusing @capacitor-firebase/messaging. Fires whenever the
  // native side hands over a token: on first launch after granting the
  // PushKit registration, and again if Apple ever reissues one.
  useEffect(() => {
    if (Capacitor.getPlatform() !== "ios") return;
    let listener: { remove: () => void } | undefined;
    let cancelled = false;
    (async () => {
      const { NativeCallKit } = await import("@/lib/native-callkit");
      if (cancelled) return;
      listener = await NativeCallKit.addListener("voipTokenReceived", (event) => {
        localStorage.setItem(VOIP_TOKEN_STORAGE_KEY, event.token);
        registerVoipToken(event.token).catch(() => {});
      });
      // The actual delivery path, not a belt-and-suspenders extra — see
      // getPendingToken()'s own doc comment for why the addListener event
      // above alone can't be relied on for a token that arrived (the
      // common case) before this effect ever got a chance to attach it.
      const pending = await NativeCallKit.getPendingToken().catch(() => null);
      if (!cancelled && pending?.token) {
        localStorage.setItem(VOIP_TOKEN_STORAGE_KEY, pending.token);
        registerVoipToken(pending.token).catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
      listener?.remove();
    };
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let tokenListener: { remove: () => void } | undefined;
    let resumeListener: { remove: () => void } | undefined;
    let pauseListener: { remove: () => void } | undefined;
    // When the app last went to the background (App "pause"); null while it's
    // in the foreground or before the first pause.
    let pausedAt: number | null = null;
    let cancelled = false;

    // The token registered last, and for which account: a launch, a resume, a
    // sign-in and the permission sheet all run setupNotifications, but the
    // server is only told when the token or the account changed.
    let registeredKey: string | null = null;
    let setupRunning = false;
    let setupAgain = false;

    async function register(token: string) {
      const owner = userIdRef.current;
      if (!owner) return;
      const key = `${owner}:${token}`;
      if (registeredKey === key) return;
      // Platform/build ride along for the update-notice breakdown on /admin/system (see FcmToken.build).
      const app = await getNativeAppInfo();
      const result = await registerFcmToken(token, app ?? undefined).catch(() => null);
      // Persisted so sign-out (lib/sign-out-client.ts) unregisters this device.
      if (result && !result.error) {
        registeredKey = key;
        localStorage.setItem(FCM_TOKEN_STORAGE_KEY, token);
      }
    }

    async function setupNotificationsOnce() {
      const { FirebaseMessaging } = await import("@capacitor-firebase/messaging");
      if (cancelled) return;

      // Never asks: the "Turn on notifications?" sheet (PushPermissionPrompt)
      // and Settings -> Notifications show the system prompt, with an
      // explanation first. A phone whose notifications are allowed (granted,
      // or Android 12 and older, which allow them without asking) is set up.
      const current = await FirebaseMessaging.checkPermissions().catch(() => null);
      if (current?.receive !== "granted" || cancelled) return;

      // Android notification channels. Creating an existing channel again only
      // refreshes its name and description (Android keeps the importance and
      // sound it was created with). Older Android (< 8) has no channels and
      // the plugin rejects; nothing to do then. Until a channel exists, a
      // notification sent to it falls back to Firebase's default channel.
      if (Capacitor.getPlatform() === "android") {
        // Ordinary notifications (alert-push.ts): IMPORTANCE_HIGH, so they pop
        // up as a banner with the phone's sound and vibration, like any
        // messaging app's. The plugin's Android side reads "vibrate" (its
        // TypeScript type doesn't list it), hence the cast.
        await FirebaseMessaging.createChannel({
          id: ALERT_NOTIFICATION_CHANNEL_ID,
          name: channelTextRef.current.alert.name,
          description: channelTextRef.current.alert.description,
          importance: ALERT_NOTIFICATION_CHANNEL_IMPORTANCE,
          visibility: ALERT_NOTIFICATION_CHANNEL_VISIBILITY,
          lights: true,
          vibrate: true,
        } as Parameters<typeof FirebaseMessaging.createChannel>[0]).catch(() => {});
        // The low-importance channel quiet notices (the midnight birthday
        // reminder, src/lib/quiet-push.ts) are posted to: no sound, no vibration.
        await FirebaseMessaging.createChannel({
          id: QUIET_NOTIFICATION_CHANNEL_ID,
          name: channelTextRef.current.quiet.name,
          description: channelTextRef.current.quiet.description,
          importance: QUIET_NOTIFICATION_CHANNEL_IMPORTANCE,
          vibration: false, // the Android side reads "vibrate" and defaults to false, so it is off either way
          lights: false,
        }).catch(() => {});
      }

      const result = await FirebaseMessaging.getToken().catch(() => null);
      if (result?.token && !cancelled) await register(result.token);

      // Firebase can reissue a token later (app restore, security rotation,
      // etc.) — without this, a device would silently stop receiving pushes
      // until its next fresh install. Attached once per mount.
      if (!tokenListener && !cancelled) {
        const handle = await FirebaseMessaging.addListener("tokenReceived", (event) => {
          void register(event.token);
        });
        if (cancelled || tokenListener) handle.remove();
        else tokenListener = handle;
      }
      // The notification-tap listener is its own effect above, attached
      // without waiting for any of this.
    }

    // One run at a time; a request that arrives during a run gets one more
    // run after it (a sign-in landing while the launch's run is in flight).
    async function setupNotifications() {
      if (setupRunning) {
        setupAgain = true;
        return;
      }
      setupRunning = true;
      try {
        do {
          setupAgain = false;
          await setupNotificationsOnce().catch(() => {});
        } while (setupAgain && !cancelled);
      } finally {
        setupRunning = false;
      }
    }

    // The sheet / Settings asked for permission, so the answer may be "yes" now.
    const onPermissionChanged = () => void setupNotifications();
    window.addEventListener(PUSH_PERMISSION_CHANGED_EVENT, onPermissionChanged);

    // Coming back to the app (launcher icon, Recents, returning from another
    // app; Capacitor's WebView isn't torn down by backgrounding) keeps the
    // screen the user left: a chat thread, a profile, a Circle, Settings, a
    // composer. Nothing here navigates (owner rule; why the old reset to
    // /home existed and what replaced it: lib/app-resume.ts), so there is
    // nothing a call or an outgoing ring, a push tap / opened link (their own
    // navigation, above), an auth flow or the Android photo picker (whose
    // Activity closing fires "resume" too) needs protecting from here.
    //
    // What a return does:
    //  - the stale-build check, which reloads the SAME page onto a newer
    //    deploy (lib/stale-build-client.ts; it shares its throttle with
    //    stale-build-reload.tsx's visibilitychange check, so whichever fires
    //    first is the only request, and it holds off for calls, uploads,
    //    open sheets and unsent text);
    //  - after a longer absence (shouldRefreshOnReturn), the route's server
    //    data is re-read in place with router.refresh(), which keeps client
    //    state (a draft, scroll, an open sheet). Live parts already resync
    //    themselves on visibilitychange (useRealtimeEvent).
    import("@capacitor/app").then(({ App }) => {
      if (cancelled) return;
      App.addListener("pause", () => {
        pausedAt = Date.now();
      }).then((h) => {
        if (cancelled) h.remove();
        else pauseListener = h;
      });
      App.addListener("resume", () => {
        // Notifications may have been allowed in the phone's settings while
        // away: set them up now rather than at the next launch (cheap when
        // nothing changed: no server call unless the token or account did).
        void setupNotifications();
        const awayMs = pausedAt === null ? null : Date.now() - pausedAt;
        pausedAt = null;
        // Read now: by the time the build check answers, a picker that just
        // handed control back may have settled already.
        const pickerActive = isNativePickerActive();
        void reloadIfStale("foreground").then((reloading) => {
          if (cancelled) return;
          if (shouldRefreshOnReturn({ awayMs, pickerActive, reloading })) router.refresh();
        });
      }).then((h) => {
        if (cancelled) h.remove();
        else resumeListener = h;
      });
    });

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

      await setupNotifications();
    })();

    setupNotificationsRef.current = () => {
      void setupNotifications();
    };

    return () => {
      cancelled = true;
      setupNotificationsRef.current = null;
      window.removeEventListener(PUSH_PERMISSION_CHANGED_EVENT, onPermissionChanged);
      tokenListener?.remove();
      resumeListener?.remove();
      pauseListener?.remove();
    };
  }, [router]);

  // The account can change without this component remounting (sign-in,
  // sign-out and switching accounts are client-side navigations), so the
  // phone's token is registered for whoever is signed in now. Before this a
  // phone signed into a second account in the same app session sent that
  // account's notifications nowhere until the app was restarted. On the
  // first render the ref is still null and the stable effect's own launch
  // run registers instead.
  useEffect(() => {
    userIdRef.current = userId;
    if (!Capacitor.isNativePlatform() || !userId) return;
    setupNotificationsRef.current?.();
  }, [userId]);

  return null;
}
