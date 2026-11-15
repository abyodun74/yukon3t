"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { MuseFeed } from "@/components/muse-feed";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { OverlayPortal, useOverlayZ } from "@/components/overlay-root";
import { suspendAutoplayOnView } from "@/lib/use-autoplay-on-view";
import { useViewerHistory } from "@/lib/viewer-history";
import type { MuseSeedPost } from "@/lib/muse-from-feed";

/**
 * The Muse viewer over the Home feed, opened by tapping a short feed video (opensInMuse): starts on that post and
 * carries on into the Muse feed. The feed stays mounted underneath, so closing lands exactly where the reader was,
 * with nothing reloaded.
 *
 * History is the shared viewer handling (useViewerHistory, src/lib/viewer-history.ts, the same as the Story viewer's):
 * opening adds one same-URL entry, which is what lets the browser's and Android's back button close it (Capacitor's
 * Android shell goes back in the WebView's history when nothing handles the button). The comments sheet, its emoji/GIF
 * panel, a confirmation and the Share sheet each add their own entry on top, so back closes those first. The close
 * button and Escape go back through every entry rather than closing directly, so none lingers behind; an in-app link
 * inside it (the author's name, "View original", a name in the comments) does the same and then navigates from the
 * page's own entry, so Back from the destination returns to Home. aria-modal keeps nav.tsx's swipe-between-tabs out of
 * gestures made in here.
 */
export function MuseViewerOverlay({
  seedPost,
  currentUserId,
  onClosed,
}: {
  seedPost: MuseSeedPost;
  currentUserId: string;
  onClosed: () => void;
}) {
  const { close, closeThen } = useViewerHistory(onClosed);
  const router = useRouter();
  const dialogRef = useDialogFocus<HTMLDivElement>(true, close);
  const viewerZ = useOverlayZ("viewer");

  function navigate(href: string) {
    // The soft keyboard (a comment being typed) goes down with the viewer.
    const active = document.activeElement;
    if (active instanceof HTMLElement && dialogRef.current?.contains(active)) active.blur();
    closeThen(() => router.push(href));
  }

  useEffect(() => suspendAutoplayOnView(), []);

  return (
    <OverlayPortal z={viewerZ}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Muse"
        tabIndex={-1}
        // The viewer layer (src/lib/overlay-layers.ts), portaled to the root overlay host: above nav.tsx's header and
        // tab bar, like StoryViewer. Also the stacking context for MuseFeed's own layers (its comments sheet and
        // toast), so they still paint above its cards; its sheets portal one layer above this.
        className="fixed inset-0 bg-black outline-none"
        style={{ zIndex: viewerZ }}
      >
        <MuseFeed
          initialItems={[]}
          initialCursor={null}
          currentUserId={currentUserId}
          seedPost={seedPost}
          onClose={close}
          onNavigate={navigate}
        />
      </div>
    </OverlayPortal>
  );
}
