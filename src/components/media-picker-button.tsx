"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function MediaPickerButton({
  icon,
  title,
  disabled,
  options,
  className,
  children,
  menuPlacement = "top",
}: {
  icon?: ReactNode;
  title: string;
  disabled?: boolean;
  options: { label: string; icon: ReactNode; onSelect: () => void }[];
  /** Overrides the default icon-button styling entirely — for a labeled trigger (e.g. "Change photo") instead of a bare icon. */
  className?: string;
  /** Rendered instead of `icon` when given — lets the trigger show a text label (with its own icon inline) rather than an icon alone. */
  children?: ReactNode;
  /** Which side of the trigger the dropdown opens toward. Defaults to "top" (composer toolbars, near the bottom of the screen); pass "bottom" for a trigger near the top of the page. */
  menuPlacement?: "top" | "bottom";
}) {
  const MENU_WIDTH_PX = 192; // matches the dropdown's own w-48
  const [open, setOpen] = useState(false);
  // Which side the dropdown's own edge pins to — it opens toward the
  // opposite side. Defaults to the old hardcoded "left" so the first paint
  // is reasonable, but toggleOpen below measures actual space against the
  // viewport before really deciding, same pattern chat-thread.tsx's own
  // message "..." menu already uses for exactly this reason.
  const [align, setAlign] = useState<"left" | "right">("left");
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function toggleOpen() {
    if (!open) {
      // A hardcoded left-0 here was the bug: confirmed via a real user's
      // screenshot, this menu ran off the right edge of the screen
      // entirely unreadable ("Upload f...", "Record li...") once its
      // trigger button ended up near the right side of the composer, as it
      // now normally does in the rounded-pill layout. Only anchor left
      // (menu extends rightward) when there's actually room for its full
      // width before the viewport edge — otherwise anchor right instead
      // (menu extends leftward), so it always stays fully on-screen.
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) {
        const spaceRight = window.innerWidth - rect.left;
        setAlign(spaceRight >= MENU_WIDTH_PX ? "left" : "right");
      }
    }
    setOpen((v) => !v);
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        disabled={disabled}
        title={title}
        aria-label={title}
        className={
          className ??
          cn("rounded-lg p-2.5 -m-1 hover:bg-line disabled:opacity-40", open ? "text-accent" : "text-foreground-soft")
        }
      >
        {children ?? icon}
      </button>
      {open && (
        <div
          className={cn(
            "absolute z-20 w-48 overflow-hidden rounded-lg border border-line bg-surface shadow-lg",
            menuPlacement === "bottom" ? "top-full mt-1" : "bottom-full mb-1",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {options.map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => {
                setOpen(false);
                option.onSelect();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-line"
            >
              {option.icon}
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
