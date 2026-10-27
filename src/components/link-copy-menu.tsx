"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Check, Image as ImageIcon, Link2, Share2 } from "lucide-react";
import { hapticSelection } from "@/lib/haptics";
import { canShareNatively, shareNative } from "@/lib/native-share";
import {
  copyImageNatively,
  copyImageToClipboard,
  copyTextToClipboard,
  detectImageClipboardSupport,
} from "@/lib/copy-image";
import type { feedEn } from "@/lib/i18n/en/feed";
import {
  LONG_PRESS_DELAY_MS,
  LONG_PRESS_IDLE,
  classifyPressTarget,
  longPressReducer,
  placeLinkMenu,
  type CopyTarget,
  type LongPressEvent,
  type LongPressState,
} from "@/lib/link-copy-menu";

/**
 * App-wide press-and-hold rule: no URL is ever shown. The WebView's / browser's own link and image menus (URL
 * header, link preview, "open in new tab", image address) are blocked everywhere; pressing and holding (or
 * right-clicking / the context-menu key on) a photo or link highlights it and shows this small menu instead:
 * "Copy photo" puts the picture itself on the clipboard (pasted as a photo into a chat or another app), "Copy link"
 * copies the link's real destination (the URL is never displayed). The Android app copies the photo through its
 * native `ImageClipboard` plugin (Android WebView's own clipboard drops pictures, see `imageClipboardSupport`); an
 * older installed Android build without that plugin offers the native share sheet for the photo instead, and any
 * other device that can't put a picture on the clipboard says so. Profile pictures, secret-chat media, videos and full-screen viewers are
 * not copyable (rules in the pure `src/lib/link-copy-menu.ts`). Plain text keeps native selection and its Copy /
 * Select all toolbar; inputs, textareas and contenteditable keep native Cut/Copy/Paste untouched. A normal tap
 * still navigates. Mounted once in the root layout; all detection is on `document` in the capture phase. A
 * component that handles a link/media long-press itself adds `data-no-link-menu`.
 */

type Labels = typeof feedEn.pressMenu;

type OpenMenu = {
  x: number;
  y: number;
  copy: CopyTarget;
  anchor: Element;
  /** Opened from the keyboard: focus goes back to the link on close. */
  fromKeyboard: boolean;
  /**
   * Move focus into the menu (keyboard / mouse). Not for touch: focusing would blur a focused composer and drop the
   * on-screen keyboard just because a link in the thread was pressed.
   */
  focusItem: boolean;
};

type Status = "idle" | "working" | "done" | "failed" | "unsupported";

/** After a long-press opened the menu, the tap/click the browser may still synthesize on release must not navigate. */
const SUPPRESS_CLICK_MS = 800;
const DONE_CLOSE_MS = 1200;
/** The pressed element carries this attribute (value "image" or "link") while the menu is open; styled in globals.css. */
const HIGHLIGHT_ATTR = "data-press-highlight";

/**
 * What the photo action is on this device: copy it natively (Android app with the plugin), copy it through the
 * web clipboard, share it (older Android app build without the plugin), or nothing but an honest message.
 */
type PhotoMode = "copy-native" | "copy-web" | "share" | "none";

function photoMode(): PhotoMode {
  const support = detectImageClipboardSupport();
  if (support === "native") return "copy-native";
  if (support === "web") return "copy-web";
  return canShareNatively() ? "share" : "none";
}

export function LinkCopyMenu({ labels }: { labels: Labels }) {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [mode, setMode] = useState<PhotoMode>("copy-web");
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRef = useRef<HTMLButtonElement | null>(null);
  const menuStateRef = useRef<OpenMenu | null>(null);
  const pathname = usePathname();

  const close = useCallback((restoreFocus: boolean) => {
    const current = menuStateRef.current;
    menuStateRef.current = null;
    setMenu(null);
    setStatus("idle");
    setPosition(null);
    if (restoreFocus && current?.fromKeyboard && current.anchor instanceof HTMLElement) {
      current.anchor.focus({ preventScroll: true });
    }
  }, []);

  const open = useCallback((next: OpenMenu) => {
    menuStateRef.current = next;
    setStatus("idle");
    setPosition(null);
    if (next.copy.type === "image") setMode(photoMode());
    setMenu(next);
  }, []);

  // Detection: touch long-press, contextmenu (right-click, Android long-press, the menu key / Shift+F10), drag.
  useEffect(() => {
    let lp: LongPressState = LONG_PRESS_IDLE;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pressId = 0;
    let pending: { anchor: Element; copy: CopyTarget } | null = null;
    let suppressClick: { anchor: Element; until: number } | null = null;
    let lastTouchAt = 0;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const dispatch = (event: LongPressEvent) => {
      const result = longPressReducer(lp, event);
      lp = result.state;
      if (lp.phase !== "pressing") clearTimer();
      if (result.fire && lp.phase === "fired" && pending) {
        suppressClick = { anchor: pending.anchor, until: Date.now() + SUPPRESS_CLICK_MS };
        window.getSelection()?.removeAllRanges();
        void hapticSelection();
        open({
          x: lp.x,
          y: lp.y,
          copy: pending.copy,
          anchor: pending.anchor,
          fromKeyboard: false,
          focusItem: false,
        });
      }
    };

    const inMenu = (target: EventTarget | null) =>
      Boolean(menuRef.current && target instanceof Node && menuRef.current.contains(target));

    const onTouchStart = (e: TouchEvent) => {
      lastTouchAt = Date.now();
      if (inMenu(e.target)) return;
      const target = classifyPressTarget(e.target instanceof Element ? e.target : null, window.location.href);
      if (target.kind !== "menu") {
        // Only links and photos get our menu; everything else keeps its native long-press (text selection, inputs).
        pending = null;
        dispatch({ type: "cancel" });
        return;
      }
      pending = { anchor: target.element, copy: target.copy };
      const touch = e.touches[0];
      pressId += 1;
      const id = pressId;
      dispatch({ type: "down", id, x: touch.clientX, y: touch.clientY, at: Date.now(), touches: e.touches.length });
      clearTimer();
      if (lp.phase === "pressing") {
        timer = setTimeout(() => dispatch({ type: "timeout", id, at: Date.now() }), LONG_PRESS_DELAY_MS);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (lp.phase !== "pressing") return;
      if (e.touches.length !== 1) {
        dispatch({ type: "cancel" });
        return;
      }
      dispatch({ type: "move", x: e.touches[0].clientX, y: e.touches[0].clientY });
    };

    const onTouchEnd = (e: TouchEvent) => {
      const fired = lp.phase === "fired";
      dispatch({ type: e.type === "touchcancel" ? "cancel" : "up" });
      if (fired) {
        // Release after a long-press: no synthesized click/navigation, and no stray word selection left behind.
        if (e.cancelable) e.preventDefault();
        window.getSelection()?.removeAllRanges();
      }
    };

    const onScroll = () => {
      dispatch({ type: "scroll" });
      if (menuStateRef.current) close(false);
    };

    const onContextMenu = (e: MouseEvent) => {
      if (inMenu(e.target)) {
        e.preventDefault();
        return;
      }
      const target = classifyPressTarget(e.target instanceof Element ? e.target : null, window.location.href);
      if (target.kind === "native") return;
      const fromTouch = Date.now() - lastTouchAt < 2000;
      if (target.kind === "plain") {
        // Touch: keep native text selection (its toolbar is Copy / Select all, no URL); blocking this contextmenu
        // would also stop Android selecting the word. Mouse/keyboard: block the browser menu (which can show
        // addresses) unless text is selected, so the native Copy stays reachable for a selection.
        if (fromTouch) return;
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed && selection.toString().trim()) return;
        e.preventDefault();
        return;
      }
      e.preventDefault();
      if (target.kind === "suppress") return;
      // Android fires contextmenu after our own long-press timer already opened the menu for this element.
      if (menuStateRef.current?.anchor === target.element) return;
      const fromKeyboard = e.clientX === 0 && e.clientY === 0;
      let x = e.clientX;
      let y = e.clientY;
      if (fromKeyboard) {
        const rect = target.element.getBoundingClientRect();
        x = rect.left + Math.min(rect.width, 160) / 2;
        y = rect.bottom + 4;
      }
      dispatch({ type: "cancel" });
      suppressClick = { anchor: target.element, until: Date.now() + SUPPRESS_CLICK_MS };
      window.getSelection()?.removeAllRanges();
      open({
        x,
        y,
        copy: target.copy,
        anchor: target.element,
        fromKeyboard,
        focusItem: fromKeyboard || !fromTouch,
      });
    };

    const onClick = (e: MouseEvent) => {
      if (!suppressClick) return;
      if (Date.now() > suppressClick.until) {
        suppressClick = null;
        return;
      }
      if (e.target instanceof Node && suppressClick.anchor.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        suppressClick = null;
      }
    };

    const onDragStart = (e: DragEvent) => {
      // Dragging a link or image out would put its URL wherever it is dropped.
      const target = classifyPressTarget(e.target instanceof Element ? e.target : null, window.location.href);
      if (target.kind === "menu" || target.kind === "suppress") e.preventDefault();
    };

    const capturePassive = { capture: true, passive: true } as const;
    document.addEventListener("touchstart", onTouchStart, capturePassive);
    document.addEventListener("touchmove", onTouchMove, capturePassive);
    document.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });
    document.addEventListener("touchcancel", onTouchEnd, { capture: true, passive: false });
    document.addEventListener("scroll", onScroll, capturePassive);
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("dragstart", onDragStart, true);
    return () => {
      clearTimer();
      document.removeEventListener("touchstart", onTouchStart, capturePassive);
      document.removeEventListener("touchmove", onTouchMove, capturePassive);
      document.removeEventListener("touchend", onTouchEnd, { capture: true });
      document.removeEventListener("touchcancel", onTouchEnd, { capture: true });
      document.removeEventListener("scroll", onScroll, capturePassive);
      document.removeEventListener("contextmenu", onContextMenu, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("dragstart", onDragStart, true);
    };
  }, [open, close]);

  // Highlight the pressed photo/link while the menu is open; cleared on close (or when another one opens).
  useEffect(() => {
    if (!menu) return;
    const el = menu.anchor;
    el.setAttribute(HIGHLIGHT_ATTR, menu.copy.type);
    return () => el.removeAttribute(HIGHLIGHT_ATTR);
  }, [menu]);

  // While open: tap/click outside, Escape, Tab, resize, or navigating away closes it.
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      close(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
      } else if (e.key === "Tab") {
        close(true);
      }
    };
    const onResize = () => close(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onResize);
    };
  }, [menu, close]);

  useEffect(() => {
    if (menuStateRef.current) close(false);
  }, [pathname, close]);

  // Measure, then place near the press point inside the viewport; focus the action.
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    setPosition(
      placeLinkMenu(
        { x: menu.x, y: menu.y },
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
    if (menu.focusItem) itemRef.current?.focus({ preventScroll: true });
  }, [menu]);

  useEffect(() => {
    if (status !== "done") return;
    const t = setTimeout(() => close(true), DONE_CLOSE_MS);
    return () => clearTimeout(t);
  }, [status, close]);

  if (!menu) return null;
  const copy = menu.copy;
  const isPhoto = copy.type === "image";

  async function act() {
    if (status === "working") return;
    if (copy.type === "link") {
      const ok = await copyTextToClipboard(copy.text);
      setStatus(ok ? "done" : "failed");
      if (ok) void hapticSelection();
      return;
    }
    if (mode === "none") {
      setStatus("unsupported");
      return;
    }
    setStatus("working");
    if (mode === "copy-web" || mode === "copy-native") {
      // Web: called straight from the tap, so the clipboard write keeps the user gesture (see copyImageToClipboard).
      const ok = mode === "copy-native" ? await copyImageNatively(copy.src) : await copyImageToClipboard(copy.src);
      setStatus(ok ? "done" : "failed");
      if (ok) void hapticSelection();
      return;
    }
    // Older Android app build without the ImageClipboard plugin: its WebView clipboard can't carry a picture, so
    // hand the photo to the system share sheet, branded like every other photo shared out of the app (share-modal.tsx).
    const ext = copy.src.match(/\.(png|webp|jpe?g)(?:[?#]|$)/i)?.[1]?.toLowerCase() ?? "jpg";
    const result = await shareNative({
      sources: [{ src: copy.src, fileName: `yukon3t-photo-${Date.now()}.${ext}`, watermark: true }],
    });
    if (result.canceled) {
      setStatus("idle");
      return;
    }
    if (result.attachedFiles && !result.warning) close(false);
    else setStatus("failed");
  }

  const actionLabel = !isPhoto
    ? labels.copyLink
    : mode === "share"
      ? labels.sharePhoto
      : status === "working"
        ? labels.copyingPhoto
        : labels.copyPhoto;
  const statusText =
    status === "done"
      ? isPhoto
        ? labels.photoCopied
        : labels.linkCopied
      : status === "failed"
        ? isPhoto
          ? labels.copyPhotoFailed
          : labels.copyLinkFailed
        : status === "unsupported"
          ? labels.photoCopyUnsupported
          : "";
  // In the Android app the photo row is "Share photo"; say why up front rather than after a tap.
  const note = isPhoto && mode === "share" && status === "idle" ? labels.photoCopyUseShare : "";
  const Icon = status === "done" ? Check : !isPhoto ? Link2 : mode === "share" ? Share2 : ImageIcon;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={labels.label}
      data-no-link-menu
      className="link-copy-menu fixed z-[300] min-w-40 max-w-[min(18rem,calc(100vw-24px))] rounded-xl border border-line bg-surface p-1 text-sm text-foreground shadow-[var(--shadow-md)]"
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        ref={itemRef}
        type="button"
        role="menuitem"
        onClick={act}
        aria-busy={status === "working" || undefined}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start font-medium hover:bg-accent-soft focus-visible:bg-accent-soft focus-visible:outline-none"
      >
        <Icon size={16} className={status === "done" ? "shrink-0 text-success" : "shrink-0 text-accent"} aria-hidden />
        <span>{actionLabel}</span>
      </button>
      {note && <p className="px-3 pb-1.5 pt-0.5 text-xs text-foreground-soft">{note}</p>}
      <p
        role="status"
        aria-live="polite"
        className={statusText ? "px-3 pb-1.5 pt-0.5 text-xs text-foreground-soft" : "sr-only"}
      >
        {statusText}
      </p>
    </div>
  );
}
