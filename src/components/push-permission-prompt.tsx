"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { BellRing } from "lucide-react";
import { Sheet } from "@/components/sheet";
import { useUiText } from "@/components/ui-text";
import { checkNativePushPermission, requestNativePushPermission } from "@/lib/native-push-client";
import { currentWebPushPermission, enableWebPush, syncWebPushSubscription } from "@/lib/web-push-client";
import {
  nextPushAskRecord,
  parsePushAskRecord,
  pushAskStorageKey,
  shouldOfferPushPrompt,
  type PushPermission,
} from "@/lib/push-permission";

// Long enough that the sheet never competes with Home's first paint (or the splash), short enough to still feel like
// part of arriving.
const ASK_DELAY_MS = 1500;

function readRecord(userId: string) {
  try {
    return parsePushAskRecord(localStorage.getItem(pushAskStorageKey(userId)));
  } catch {
    return null;
  }
}

function writeRecord(userId: string, now: number) {
  try {
    localStorage.setItem(pushAskStorageKey(userId), JSON.stringify(nextPushAskRecord(readRecord(userId), now)));
  } catch {
    // Blocked storage: the sheet may come back sooner, nothing worse.
  }
}

/**
 * "Turn on notifications?": mounted once for signed-in members (layout.tsx), in the native app and in browsers.
 *
 * Without notification permission YuKon3t can only show the in-app bell and badges, which is what people saw when
 * nobody had asked them (or the bare system prompt came with no explanation and was refused). On Home, while the
 * system prompt can still be shown, this explains what notifications are for and only then opens the system prompt
 * (rules and limits: src/lib/push-permission.ts). Settings -> Notifications has the same button at any time.
 *
 * It also keeps a browser's Web Push subscription attached to whoever is signed in (syncWebPushSubscription), and
 * strips completeOnboarding's ?onboarded=1 marker from the address bar.
 */
export function PushPermissionPrompt({ userId }: { userId: string }) {
  const pathname = usePathname();
  const t = useUiText().t.pushPrompt;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Checked once per page session (and again after an account switch), not on every visit to Home.
  const checkedForRef = useRef<string | null>(null);

  // Browsers only: an already-allowed browser is (re)subscribed for this account on every load.
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    void syncWebPushSubscription();
  }, [userId]);

  useEffect(() => {
    if (pathname !== "/home") return;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("onboarded") === "1") {
        url.searchParams.delete("onboarded");
        window.history.replaceState(window.history.state, "", url.toString());
      }
    } catch {
      // Nothing to strip.
    }
    if (checkedForRef.current === userId) return;
    checkedForRef.current = userId;

    let cancelled = false;
    let started = false;
    const timer = setTimeout(async () => {
      started = true;
      const permission: PushPermission = Capacitor.isNativePlatform()
        ? await checkNativePushPermission()
        : currentWebPushPermission();
      if (cancelled) return;
      const now = Date.now();
      const otherModalOpen = document.querySelector('[aria-modal="true"]') !== null;
      if (
        !shouldOfferPushPrompt({ permission, pathname: window.location.pathname, record: readRecord(userId), now, otherModalOpen })
      ) {
        // Something else was on screen: try again on the next visit to Home (no ask is counted).
        if (otherModalOpen && checkedForRef.current === userId) checkedForRef.current = null;
        return;
      }
      writeRecord(userId, now);
      setOpen(true);
    }, ASK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      // Left Home before the check ran: try again on the next visit.
      if (!started && checkedForRef.current === userId) checkedForRef.current = null;
    };
  }, [pathname, userId]);

  async function allow() {
    setBusy(true);
    try {
      // Straight from the tap: browsers ignore a permission request that isn't.
      if (Capacitor.isNativePlatform()) await requestNativePushPermission();
      else await enableWebPush();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={() => setOpen(false)}
      variant="bottom-sheet"
      responsive
      panelClassName="p-5"
      ariaLabel={t.title}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <BellRing size={18} aria-hidden />
        </span>
        <div>
          <h2 className="text-base font-semibold">{t.title}</h2>
          <p className="mt-1 text-sm text-foreground-soft">{t.body}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={allow}
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          {t.allow}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="rounded-lg px-4 py-2.5 text-sm font-medium text-foreground-soft disabled:opacity-50"
        >
          {t.later}
        </button>
      </div>
    </Sheet>
  );
}
