"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { isNativePickerActive } from "@/lib/native-picker-activity";
import { hiddenRelockStep } from "@/lib/app-resume";
import { OverlayPortal, useOverlayZ } from "@/components/overlay-root";

const LOCK_URL = "/api/hidden-chats/lock";

/**
 * Mounted on every hidden route (the hidden-chats page and an unlocked hidden thread): the moment the page is hidden
 * (tab switched, app backgrounded, phone locked) the unlock cookie is cleared, so whoever picks the phone up next has
 * to enter the PIN again. sendBeacon because an ordinary request from a page being suspended is often never sent.
 *
 * Returning to the app keeps the screen the person left (lib/app-resume.ts), so this is what keeps a hidden chat
 * protected on the way back: the page is covered as it is hidden (an opaque screen, below calls so a call in progress
 * stays on top), and on return the lock is sent once more and awaited (the beacon may not have arrived, or may still
 * be in flight on a quick switch), then the route is re-rendered: the server answers a hidden thread with a redirect to
 * the PIN prompt (messages/[id]/page.tsx, hiddenUnlockPath, which returns to the thread once unlocked) and the
 * hidden-chats page with its locked state. The cover goes only with that re-render, so the chat is never shown again
 * in between.
 *
 * Not while a native photo/video picker is open: that hands off to another Activity, which hides the page exactly like
 * backgrounding does, and re-locking there would throw away the attachment being picked.
 */
export function HiddenRelock() {
  const router = useRouter();
  const [covered, setCovered] = useState(false);
  const [, startTransition] = useTransition();
  const coverZ = useOverlayZ("blocking");

  useEffect(() => {
    let relocked = false;
    let cancelled = false;
    function onVisibilityChange() {
      const step = hiddenRelockStep({
        visibility: document.visibilityState === "hidden" ? "hidden" : "visible",
        pickerActive: isNativePickerActive(),
        relocked,
      });
      if (step === "lock") {
        if (!navigator.sendBeacon(LOCK_URL)) {
          void fetch(LOCK_URL, { method: "POST", keepalive: true }).catch(() => {});
        }
        relocked = true;
        setCovered(true);
      } else if (step === "show-pin-prompt") {
        relocked = false;
        void fetch(LOCK_URL, { method: "POST", cache: "no-store" })
          .catch(() => {})
          .then(() => {
            if (cancelled) return;
            // One transition: the cover goes when the re-rendered (locked) route commits, not before.
            startTransition(() => {
              setCovered(false);
              router.refresh();
            });
          });
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router]);

  if (!covered) return null;
  return (
    <OverlayPortal z={coverZ}>
      <div aria-hidden className="fixed inset-0 bg-background" style={{ zIndex: coverZ }} />
    </OverlayPortal>
  );
}
