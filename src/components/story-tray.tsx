"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
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
  onAdd,
}: {
  avatarUrl: string | null;
  label: string;
  fallbackLetter?: string;
  hasUnseen: boolean;
  hasStories: boolean;
  onClick: () => void;
  // Only set for "Your story" — a standalone affordance to add another
  // story that's always available, independent of onClick (which, once you
  // already have a story, is taken over by opening the viewer instead).
  onAdd?: () => void;
}) {
  return (
    <div className="relative flex w-16 shrink-0 flex-col items-center gap-1">
      <button type="button" onClick={onClick} className="flex flex-col items-center gap-1">
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
      {onAdd && hasStories && (
        <button
          type="button"
          onClick={onAdd}
          aria-label="Add to your story"
          className="absolute right-1 top-0 rounded-full border-2 border-background bg-accent p-1 text-accent-ink"
        >
          <Plus size={12} />
        </button>
      )}
    </div>
  );
}

/**
 * Horizontal ring row above the /home composer — "Your story" first (tapping
 * it opens the upload modal if you have none active, otherwise your own
 * stack; a separate "+" badge, once you have at least one, always opens the
 * upload modal so you can add another — same pattern as ProfileStoryRing),
 * then connections with an active story, unseen ones styled distinctly.
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
          onAdd={() => setUploadOpen(true)}
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
