"use client";

import { useEffect, useRef } from "react";
import { MuseFeed } from "@/components/muse-feed";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { suspendAutoplayOnView } from "@/lib/use-autoplay-on-view";
import type { MuseSeedPost } from "@/lib/muse-from-feed";

/**
 * The Muse viewer over the Home feed, opened by tapping a short feed video (opensInMuse): starts on that post and
 * carries on into the Muse feed. The feed stays mounted underneath, so closing lands exactly where the reader was,
 * with nothing reloaded.
 *
 * Opening adds one history entry (same URL, so Next.js doesn't navigate), which is what lets the browser's and
 * Android's back button close it: Capacitor's Android shell goes back in the WebView's history when nothing handles
 * the button. The close button and Escape go back through that same entry rather than closing directly, so it never
 * lingers behind. aria-modal keeps nav.tsx's swipe-between-tabs out of gestures made in here.
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
  const onClosedRef = useRef(onClosed);
  useEffect(() => {
    onClosedRef.current = onClosed;
  });

  // One back per opening: a double tap on close must not also leave /home.
  const closingRef = useRef(false);
  function close() {
    if (closingRef.current) return;
    closingRef.current = true;
    window.history.back();
  }
  const dialogRef = useDialogFocus<HTMLDivElement>(true, close);

  const pushedRef = useRef(false);
  useEffect(() => {
    // A ref, not the effect alone: React's development double-run of effects would otherwise push two entries.
    if (!pushedRef.current) {
      pushedRef.current = true;
      window.history.pushState({ museViewer: true }, "");
    }
    // Back from a Muse's open comments lands on this viewer's own entry again (MuseFeed adds one for the comments on
    // top of it): that closes the comments only. Any other back leaves the viewer.
    const onPopState = () => {
      if ((window.history.state as { museViewer?: boolean } | null)?.museViewer) return;
      onClosedRef.current();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => suspendAutoplayOnView(), []);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Muse"
      tabIndex={-1}
      // Above nav.tsx's header and tab bar, like StoryViewer. Also the stacking context for MuseFeed's own layers
      // (its comments sheet, share sheet and toast), so they still paint above its cards.
      className="fixed inset-0 z-[70] bg-black outline-none"
    >
      <MuseFeed initialItems={[]} initialCursor={null} currentUserId={currentUserId} seedPost={seedPost} onClose={close} />
    </div>
  );
}
