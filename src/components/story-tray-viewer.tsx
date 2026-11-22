"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StoryViewer, type StoryData } from "@/components/story-viewer";
import { PageMediaHold } from "@/components/page-media-hold";
import { useViewerHistory } from "@/lib/viewer-history";

export type StoryTrayAuthorGroup = {
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  isMe: boolean;
  hasUnseen: boolean;
  stories: StoryData[];
};

/**
 * Thin wrapper around the existing (unmodified) StoryViewer — that component
 * already advances through one author's stories and calls onNextAuthor (or
 * onClose, if this is the last author) once the last one is passed, plus
 * calls onNextAuthor/onPrevAuthor directly on a left/right swipe (see
 * SWIPE_THRESHOLD_PX in story-viewer.tsx). This tracks which author in the
 * tray is currently open and which direction the most recent move was, so
 * each new StoryViewer mount can glide in from the correct side instead of
 * cutting instantly (see the .story-glide-* classes in globals.css) —
 * remounting per author (via `key`) rather than animating one persistent
 * instance is deliberate: it gets every story-specific bit of internal
 * state (index, pause, reaction summary, viewers list, ...) reset for free
 * instead of needing to reset each one by hand.
 */
export function StoryTrayViewer({
  groups,
  startAuthorIndex,
  startStoryIndex = 0,
  currentUserId,
  onClose,
}: {
  groups: StoryTrayAuthorGroup[];
  startAuthorIndex: number;
  /** The story to start on within the first person's stack (a profile's `?story=` deep link); later people start at 0. */
  startStoryIndex?: number;
  currentUserId: string;
  onClose: () => void;
}) {
  const [authorIndex, setAuthorIndex] = useState(startAuthorIndex);
  // A single person (a profile's own story ring) opens without the sideways glide, as it always has.
  const [direction, setDirection] = useState<"next" | "prev" | undefined>(groups.length > 1 ? "next" : undefined);
  // The viewer's one history entry lives here, not in StoryViewer, which remounts per person (see the comment above).
  // Every way out (X, Escape, a drag down, back, the end of the last story) goes through it.
  const { close, closeThen } = useViewerHistory(onClose);
  const router = useRouter();
  // A link inside the viewer (the author's name, "View post"): leave the viewer's history entries first, then navigate
  // from the page's own entry, so Back from the destination lands on the page that was open, not an orphan copy.
  const navigate = (href: string) => closeThen(() => router.push(href));
  const group = groups[authorIndex];
  if (!group) return null;

  function goToNextAuthor() {
    // Same reasoning as StoryViewer's own `next`: check the boundary
    // against `authorIndex` directly and call onClose as a plain function
    // call, not from inside setAuthorIndex's updater — calling a different
    // component's setState from within it triggers React's "Cannot update
    // a component while rendering a different component" warning.
    if (authorIndex + 1 >= groups.length) {
      close();
      return;
    }
    setDirection("next");
    setAuthorIndex(authorIndex + 1);
  }

  function goToPrevAuthor() {
    // First person in the tray — nobody to swipe back to. Instagram just
    // ignores a right-swipe here too rather than closing or bouncing.
    if (authorIndex === 0) return;
    setDirection("prev");
    setAuthorIndex(authorIndex - 1);
  }

  return (
    <>
      {/* Outside the per-person key: one hold for the viewer's whole life (see PageMediaHold). */}
      <PageMediaHold />
      <StoryViewer
        key={group.authorId}
        stories={group.stories}
        startIndex={authorIndex === startAuthorIndex ? startStoryIndex : 0}
        authorId={group.authorId}
        authorName={group.authorName}
        authorAvatarUrl={group.authorAvatarUrl}
        isOwner={group.isMe}
        currentUserId={currentUserId}
        direction={direction}
        onNextAuthor={goToNextAuthor}
        onPrevAuthor={goToPrevAuthor}
        onClose={close}
        onNavigate={navigate}
      />
    </>
  );
}
