"use client";

import { useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { CircleShareSheet, type ShareableCircle } from "@/components/circle-share-sheet";
import { useCircleShareText } from "@/components/circle-share-text";
import { useLongPress } from "@/lib/use-long-press";
import { cn } from "@/lib/utils";

/**
 * THE wrapper for a Circle anywhere Circles are listed (the Circles page, search and smart search results, sub-circle
 * lists, the Circle switcher rail): a long press (touch), right-click or ContextMenu key / Shift+F10 on it opens the
 * Circle's share sheet (CircleShareSheet). A normal tap still follows the link inside; a long press never navigates,
 * selects text or shows the native callout. `src/components/circle-long-press-usage.test.ts` fails if a Circle list
 * renders a Circle link without it.
 *
 * `data-no-link-menu` opts the card out of the app-wide link menu (LinkCopyMenu), which would otherwise answer the
 * same long press on the link with its own "Copy link" popover. The sheet is rendered next to the wrapper, not in it,
 * so clicks and keys inside the sheet never reach the wrapper's handlers.
 */
export function CircleLongPress({
  circle,
  canInvite = false,
  className,
  children,
}: {
  circle: ShareableCircle;
  canInvite?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const handlers = useLongPress(() => setOpen(true));
  return (
    <>
      <div
        {...handlers}
        data-no-link-menu=""
        data-circle-long-press=""
        className={cn("select-none [-webkit-touch-callout:none]", className)}
      >
        {children}
      </div>
      <CircleShareSheet circle={circle} canInvite={canInvite} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * The explicit, accessible way to the same sheet (long press alone is neither discoverable nor reachable by a screen
 * reader or switch user): a focusable button with an accessible name, on a Circle's page header.
 */
export function CircleShareButton({
  circle,
  canInvite = false,
  className,
}: {
  circle: ShareableCircle;
  canInvite?: boolean;
  className?: string;
}) {
  const { t } = useCircleShareText();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t.open}
        aria-haspopup="dialog"
        title={t.open}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg border border-line text-foreground-soft hover:border-accent hover:text-accent",
          className,
        )}
      >
        <MoreHorizontal size={18} aria-hidden />
      </button>
      <CircleShareSheet circle={circle} canInvite={canInvite} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
