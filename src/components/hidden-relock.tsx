"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isNativePickerActive } from "@/lib/native-picker-activity";

/**
 * Mounted on every hidden route (the hidden-chats page and an unlocked hidden thread): the moment the page is hidden
 * (tab switched, app backgrounded, phone locked) the unlock cookie is cleared, so whoever picks the phone up next has
 * to enter the PIN again. sendBeacon because an ordinary request from a page being suspended is often never sent.
 * Coming back re-renders the route, which is what turns the screen back into the PIN prompt.
 *
 * Not while a native photo/video picker is open: that hands off to another Activity, which hides the page exactly like
 * backgrounding does, and re-locking there would throw away the attachment being picked.
 */
export function HiddenRelock() {
  const router = useRouter();

  useEffect(() => {
    let relocked = false;
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        if (isNativePickerActive()) return;
        if (!navigator.sendBeacon("/api/hidden-chats/lock")) {
          void fetch("/api/hidden-chats/lock", { method: "POST", keepalive: true }).catch(() => {});
        }
        relocked = true;
      } else if (relocked) {
        relocked = false;
        router.refresh();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [router]);

  return null;
}
