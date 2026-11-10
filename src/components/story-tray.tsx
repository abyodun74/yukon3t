"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { protectedImageProps } from "@/lib/protected-image";
import { useImageFallback } from "@/lib/use-image-fallback";
import { StoryUploadModal } from "@/components/story-upload-modal";
import { CreatePickerButton } from "@/components/create-picker-sheet";
import { StoryTrayViewer, type StoryTrayAuthorGroup } from "@/components/story-tray-viewer";
import { useFeedText } from "@/components/feed-text";
import { format } from "@/lib/i18n/locales";

function Ring({
  avatarUrl,
  label,
  fallbackLetter = label,
  hasUnseen,
  hasStories,
  onClick,
  createForUserId,
}: {
  avatarUrl: string | null;
  label: string;
  fallbackLetter?: string;
  hasUnseen: boolean;
  hasStories: boolean;
  onClick: () => void;
  // Only set for "Your story": the "+" that opens the Story / Feed post /
  // Muse picker (CreatePickerButton), always there, independent of onClick
  // (which opens your stack once you have a story, the story upload before).
  createForUserId?: string;
}) {
  const { t } = useFeedText();
  const image = useImageFallback(avatarUrl);
  return (
    <div className="relative flex w-16 min-w-0 shrink-0 flex-col items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        // Starts with the visible label so "tap <name>" works in Voice
        // Control; the rest is what the ring's color tells a sighted user.
        aria-label={hasStories ? format(hasUnseen ? t.stories.newStory : t.stories.viewStory, { name: label }) : format(t.stories.addStory, { name: label })}
        className="flex flex-col items-center gap-1"
      >
        {/*
          Two-layer ring, same technique Instagram uses: an outer circle
          painted with the ring color/gradient, a background-colored gap
          (border-background) as breathing room, then the avatar itself —
          without that gap the ring color bleeds straight into the photo and
          reads as a flat colored border instead of a distinct ring.
          hasUnseen gets the signature warm gradient; already-seen stories
          fall back to a plain neutral ring (Instagram does the same); no
          stories at all (bare "Your story" placeholder) gets no ring.
        */}
        <span
          className={cn(
            "flex h-16 w-16 items-center justify-center rounded-full p-[2px]",
            hasUnseen
              ? "bg-gradient-to-tr from-amber-400 via-rose-500 to-fuchsia-600"
              : hasStories
                ? "bg-line"
                : "",
          )}
        >
          <span
            className={cn(
              "flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-surface",
              hasStories ? "border-2 border-background" : "border border-line",
            )}
          >
            {image.show && avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" loading="lazy" decoding="async" {...image.imgProps} {...protectedImageProps("h-full w-full object-cover")} />
            ) : (
              <span className="text-xs text-foreground-soft">{fallbackLetter.slice(0, 1)}</span>
            )}
          </span>
        </span>
        {/* Wraps onto a second line instead of ellipsis-truncating a long
            name onto one — min-w-0 keeps this from being the thing that
            forces the 64px tile wider (see the Ring wrapper's own min-w-0
            for the same reasoning), line-clamp-2 is just a backstop for a
            name that's still too long even wrapped. */}
        <span className="line-clamp-2 min-w-0 w-full break-words text-center text-[0.6875rem] leading-tight text-foreground-soft">
          {label}
        </span>
      </button>
      {/* 44px tap target centred on the small badge at the ring's top-end corner (the tray's -mt-2.5 pt-2.5 keeps its
          top inside the scroll container instead of clipped). */}
      {createForUserId && <CreatePickerButton userId={createForUserId} buttonClassName="-top-2.5 -end-1.5" />}
    </div>
  );
}

/**
 * Horizontal ring row at the top of /home — "Your story" first (tapping
 * it opens the upload modal if you have none active, otherwise your own
 * stack; a separate "+" badge, always shown, opens the Story / Feed post /
 * Muse picker — same pattern as ProfileStoryRing),
 * then connections with an active story, unseen ones styled distinctly.
 */
export function StoryTray({
  groups,
  meAvatarUrl,
  meName,
  currentUserId,
}: {
  groups: StoryTrayAuthorGroup[];
  meAvatarUrl: string | null;
  meName: string;
  currentUserId: string;
}) {
  const { t } = useFeedText();
  const [openAuthorIndex, setOpenAuthorIndex] = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const myGroupIndex = groups.findIndex((g) => g.isMe);
  const myGroup = myGroupIndex >= 0 ? groups[myGroupIndex] : null;
  const others = groups.filter((g) => !g.isMe);

  return (
    <>
      <div className="-mt-2.5 flex gap-4 overflow-x-auto pb-1 pt-2.5">
        {/* Adding a story is members-only: a guest preview session gets the sign-up sheet (src/components/guest-preview.tsx). */}
        <span data-guest-block className="contents">
        <Ring
          avatarUrl={myGroup?.authorAvatarUrl ?? meAvatarUrl}
          label={t.stories.yourStory}
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
          createForUserId={currentUserId}
        />
        </span>
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
          currentUserId={currentUserId}
          onClose={() => setOpenAuthorIndex(null)}
        />
      )}

      <StoryUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </>
  );
}
