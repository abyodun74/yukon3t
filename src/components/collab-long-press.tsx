"use client";

import { useState, type ReactNode } from "react";
import { Share2 } from "lucide-react";
import { CollabShareSheet, type ShareableCollab } from "@/components/collab-share-sheet";
import { useCollabShareText } from "@/components/collab-share-text";
import { useLongPress } from "@/lib/use-long-press";
import { cn } from "@/lib/utils";

/**
 * THE wrapper for a collab anywhere collabs are listed (the Collab board's public and "your private collabs" lists,
 * search and smart search results): a long press (touch), right-click or ContextMenu key / Shift+F10 on it opens the
 * collab's share sheet (CollabShareSheet). Same mechanics as CircleLongPress: a normal tap still follows the link
 * inside; a long press never navigates, selects text or shows the native callout; vertical scrolling is untouched
 * (useLongPress). `src/components/collab-long-press-usage.test.ts` fails if a collab list renders a collab link
 * without it.
 *
 * `data-no-link-menu` opts the card out of the app-wide link menu (LinkCopyMenu), which would otherwise answer the
 * same long press on the link with its own "Copy link" popover. The sheet is rendered next to the wrapper, not in it,
 * so clicks and keys inside the sheet never reach the wrapper's handlers.
 */
export function CollabLongPress({
  collab,
  canInvite = false,
  className,
  children,
}: {
  collab: ShareableCollab;
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
        data-collab-long-press=""
        className={cn("select-none [-webkit-touch-callout:none]", className)}
      >
        {children}
      </div>
      <CollabShareSheet collab={collab} canInvite={canInvite} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * The explicit, accessible way to the same sheet (long press alone is neither discoverable nor reachable by a screen
 * reader or switch user): a focusable "Share" button with an accessible name, on a collab's page header.
 */
export function CollabShareButton({
  collab,
  canInvite = false,
  className,
}: {
  collab: ShareableCollab;
  canInvite?: boolean;
  className?: string;
}) {
  const { t } = useCollabShareText();
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
        <Share2 size={18} aria-hidden />
      </button>
      <CollabShareSheet collab={collab} canInvite={canInvite} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
