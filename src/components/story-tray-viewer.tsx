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
        setAuthorIndex((i) => {
          if (i + 1 >= groups.length) {
            onClose();
            return i;
          }
          return i + 1;
        });
      }}
    />
  );
}
