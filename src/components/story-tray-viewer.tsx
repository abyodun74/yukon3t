"use client";

import { useState } from "react";
import { StoryViewer, type StoryData } from "@/components/story-viewer";

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
 * already advances through one author's stories and calls onClose once the
 * last one is passed. This just tracks which author in the tray is
 * currently open and, instead of actually closing on that inner onClose,
 * advances to the next author's stack — closing for real only after the
 * last author.
 */
export function StoryTrayViewer({
  groups,
  startAuthorIndex,
  onClose,
}: {
  groups: StoryTrayAuthorGroup[];
  startAuthorIndex: number;
  onClose: () => void;
}) {
  const [authorIndex, setAuthorIndex] = useState(startAuthorIndex);
  const group = groups[authorIndex];
  if (!group) return null;

  return (
    <StoryViewer
      key={group.authorId}
      stories={group.stories}
      startIndex={0}
      authorId={group.authorId}
      authorName={group.authorName}
      authorAvatarUrl={group.authorAvatarUrl}
      isOwner={group.isMe}
      onClose={() => {
        // Same reasoning as StoryViewer's own `next`: check the boundary
        // against `authorIndex` directly and call onClose as a plain
        // function call, not from inside setAuthorIndex's updater — calling
        // a different component's setState (StoryTray's) from within it
        // triggers React's "Cannot update a component while rendering a
        // different component" warning.
        if (authorIndex + 1 >= groups.length) {
          onClose();
          return;
        }
        setAuthorIndex(authorIndex + 1);
      }}
    />
  );
}
