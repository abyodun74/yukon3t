"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { subscribeToPush, unsubscribeFromPush } from "@/app/actions/push";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

// Web Push wants the VAPID key as a raw Uint8Array, but only hands it out
// as a URL-safe base64 string.
function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

type Status = "unsupported" | "loading" | "off" | "on" | "denied";

/** Settings toggle for browser push notifications (incoming calls, new messages) — inert if VAPID keys aren't configured. */
export function PushNotificationsToggle() {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!VAPID_PUBLIC_KEY || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setStatus("denied");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (!cancelled) setStatus(existing ? "on" : "off");
    }
    check().catch(() => setStatus("unsupported"));
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    if (!VAPID_PUBLIC_KEY) return;
    setStatus("loading");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      await subscribeToPush(subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } });
      setStatus("on");
    } catch {
      setStatus("off");
    }
  }

  async function disable() {
    setStatus("loading");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await unsubscribeFromPush(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setStatus("off");
    } catch {
      setStatus("on");
    }
  }

  if (status === "unsupported") {
    return (
      <p className="text-sm text-foreground-soft">
        Not available on this device or browser yet.
      </p>
    );
  }

  if (status === "denied") {
    return (
      <p className="text-sm text-foreground-soft">
        Notifications are blocked for this site in your browser settings — enable them there to turn this on.
      </p>
    );
  }

  return (
    <button
      type="button"
      disabled={status === "loading"}
      onClick={status === "on" ? disable : enable}
      className="flex items-center gap-2 rounded-lg border border-line px-4 py-2.5 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
    >
      <BellRing size={15} />
      {status === "on" ? "Turn off notifications" : "Enable notifications"}
    </button>
  );
}
