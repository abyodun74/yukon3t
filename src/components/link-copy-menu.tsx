"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Check, Link2 } from "lucide-react";
import { hapticSelection } from "@/lib/haptics";
import {
  LONG_PRESS_DELAY_MS,
  LONG_PRESS_IDLE,
  classifyPressTarget,
  longPressReducer,
  placeLinkMenu,
  type LongPressEvent,
  type LongPressState,
} from "@/lib/link-copy-menu";

/**
 * App-wide long-press rule: no URL is ever shown on press-and-hold. The WebView's / browser's own link and image
 * menus (URL header, link preview, "open in new tab", image address) are blocked everywhere; pressing and holding
 * (or right-clicking / the context-menu key on) a link, photo or video shows this small menu instead, with one
 * action, "Copy link" (the link, or the page for a photo/video; the URL itself is never displayed). Plain text keeps
 * native selection and its Copy / Select all toolbar; inputs, textareas and contenteditable keep native
 * Cut/Copy/Paste untouched. A normal tap still navigates. Mounted once in the root layout; all detection is on
 * `document` in the capture phase, so the whole app is covered without per-component wiring. Rules live in the pure
 * `src/lib/link-copy-menu.ts`. A component that handles a link/media long-press itself adds `data-no-link-menu`.
 */

type OpenMenu = {
  x: number;
  y: number;
  copyText: string;
  anchor: Element;
  /** Opened from the keyboard: focus goes back to the link on close. */
  fromKeyboard: boolean;
  /**
   * Move focus into the menu (keyboard / mouse). Not for touch: focusing would blur a focused composer and drop the
   * on-screen keyboard just because a link in the thread was pressed.
   */
  focusItem: boolean;
};

/** After a long-press opened the menu, the tap/click the browser may still synthesize on release must not navigate. */
const SUPPRESS_CLICK_MS = 800;
const COPIED_CLOSE_MS = 1200;

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through: some WebViews refuse the async clipboard API; the legacy path below still works there.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "-9999px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    const previous = document.activeElement as HTMLElement | null;
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    area.remove();
    previous?.focus?.({ preventScroll: true });
    return ok;
  } catch {
    return false;
  }
}

export function LinkCopyMenu({
  copyLabel,
  copiedLabel,
  failedLabel,
}: {
  copyLabel: string;
  copiedLabel: string;
  failedLabel: string;
}) {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
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
    setMenu(next);
  }, []);

  // Detection: touch long-press, contextmenu (right-click, Android long-press, the menu key / Shift+F10), drag.
  useEffect(() => {
    let lp: LongPressState = LONG_PRESS_IDLE;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pressId = 0;
    let pending: { anchor: Element; copyText: string | null } | null = null;
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
      if (result.fire && lp.phase === "fired" && pending?.copyText) {
        suppressClick = { anchor: pending.anchor, until: Date.now() + SUPPRESS_CLICK_MS };
        window.getSelection()?.removeAllRanges();
        void hapticSelection();
        open({
          x: lp.x,
          y: lp.y,
          copyText: pending.copyText,
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
        // Only links and media get our menu; everything else keeps its native long-press (text selection, inputs).
        pending = null;
        dispatch({ type: "cancel" });
        return;
      }
      pending = { anchor: target.element, copyText: target.copyText };
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
        copyText: target.copyText,
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
    if (status !== "copied") return;
    const t = setTimeout(() => close(true), COPIED_CLOSE_MS);
    return () => clearTimeout(t);
  }, [status, close]);

  if (!menu) return null;

  async function copy() {
    if (!menu) return;
    const ok = await writeClipboard(menu.copyText);
    setStatus(ok ? "copied" : "failed");
    if (ok) void hapticSelection();
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={copyLabel}
      data-no-link-menu
      className="link-copy-menu fixed z-[300] min-w-40 max-w-[calc(100vw-24px)] rounded-xl border border-line bg-surface p-1 text-sm text-foreground shadow-[var(--shadow-md)]"
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
        onClick={copy}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start font-medium hover:bg-accent-soft focus-visible:bg-accent-soft focus-visible:outline-none"
      >
        {status === "copied" ? (
          <Check size={16} className="shrink-0 text-success" aria-hidden />
        ) : (
          <Link2 size={16} className="shrink-0 text-accent" aria-hidden />
        )}
        <span>{copyLabel}</span>
      </button>
      <p
        role="status"
        aria-live="polite"
        className={status === "idle" ? "sr-only" : "px-3 pb-1.5 pt-0.5 text-xs text-foreground-soft"}
      >
        {status === "copied" ? copiedLabel : status === "failed" ? failedLabel : ""}
      </p>
    </div>
  );
}
