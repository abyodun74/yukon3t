"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { classifyLink, needsDocumentLoad } from "@/lib/app-links";
import { shouldKeepInApp } from "@/lib/in-app-link-guard";

/**
 * Native app only (mounted once in layout.tsx; nothing in a browser). Capacitor hands any link the WebView can't keep
 * to the OS: on iOS every target="_blank" link and every link to another host (www.yukon3t.com included) opens Safari;
 * on Android a target="_blank" yukon3t.com link reloads the whole app in place. So a tap on a link to a YuKon3t page
 * that would leave (target="_blank", or written with the www host) is turned into an in-app navigation instead.
 * Links that already navigate in place (next/link, plain same-host links) and links to other sites are untouched.
 *
 * A document listener in the bubble phase, so it runs after React's handlers: a click a component already handled
 * (next/link's own navigation, the press-and-hold menu swallowing the click after a long press: LinkCopyMenu stops it
 * in the capture phase) arrives here `defaultPrevented` or not at all, and is left alone.
 */
export function InAppLinkGuard() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download")) return;
      const target = classifyLink(anchor.getAttribute("href"), window.location.href);
      if (target.kind !== "internal") return;
      if (!shouldKeepInApp({ target: anchor.getAttribute("target"), linkHost: anchor.host, pageHost: window.location.host })) {
        return;
      }
      e.preventDefault();
      if (needsDocumentLoad(target.path)) window.location.assign(target.path);
      else router.push(target.path);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [router]);

  return null;
}
