"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { StoryUploadModal } from "@/components/story-upload-modal";
import { StoryTrayViewer, type StoryTrayAuthorGroup } from "@/components/story-tray-viewer";

function Ring({
  avatarUrl,
  label,
  fallbackLetter = label,
  hasUnseen,
  hasStories,
  onClick,
}: {
  avatarUrl: string | null;
  label: string;
  fallbackLetter?: string;
  hasUnseen: boolean;
  hasStories: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="flex w-16 shrink-0 flex-col items-center gap-1">
      <span
        className={cn(
          "flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border bg-surface",
          hasUnseen ? "border-2 border-accent" : hasStories ? "border-2 border-line" : "border border-line",
        )}
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-xs text-foreground-soft">{fallbackLetter.slice(0, 1)}</span>
        )}
      </span>
      <span className="w-full truncate text-center text-[11px] text-foreground-soft">{label}</span>
    </button>
  );
}

/**
 * Horizontal ring row above the /home composer — "Your story" first (opens
 * the upload modal if you have none active, otherwise your own stack), then
 * connections with an active story, unseen ones styled distinctly (same
 * accent-ring convention as ProfileStoryRing).
 */
export function StoryTray({
  groups,
  meAvatarUrl,
  meName,
}: {
  groups: StoryTrayAuthorGroup[];
  meAvatarUrl: string | null;
  meName: string;
}) {
  const [openAuthorIndex, setOpenAuthorIndex] = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const myGroupIndex = groups.findIndex((g) => g.isMe);
  const myGroup = myGroupIndex >= 0 ? groups[myGroupIndex] : null;
  const others = groups.filter((g) => !g.isMe);

  return (
    <>
      <div className="flex gap-3 overflow-x-auto pb-1">
        <Ring
          avatarUrl={myGroup?.authorAvatarUrl ?? meAvatarUrl}
          label="Your story"
          fallbackLetter={meName}
          hasUnseen={false}
          hasStories={Boolean(myGroup)}
          onClick={() => {
            if (myGroup) {
              setOpenAuthorIndex(myGroupIndex);
            } else {
              setUploadOpen(true);
            }
          }}
        />
        {others.map((group) => (
          <Ring
            key={group.authorId}
            avatarUrl={group.authorAvatarUrl}
            label={group.authorName}
            hasUnseen={group.hasUnseen}
            hasStories
            onClick={() => setOpenAuthorIndex(groups.findIndex((g) => g.authorId === group.authorId))}
          />
        ))}
      </div>

      {openAuthorIndex !== null && (
        <StoryTrayViewer
          groups={groups}
          startAuthorIndex={openAuthorIndex}
          onClose={() => setOpenAuthorIndex(null)}
        />
      )}

      {uploadOpen && <StoryUploadModal onClose={() => setUploadOpen(false)} />}
    </>
  );
}
