"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { StoryViewer, type StoryData } from "@/components/story-viewer";
import { StoryUploadModal } from "@/components/story-upload-modal";
import { Lightbox } from "@/components/lightbox";

/**
 * Wraps a profile's avatar with an Instagram-style story ring (only shown
 * when there are active, non-expired stories) and, for the profile's own
 * owner, a "+" button to add one. Owns the open/close state for both the
 * viewer and upload overlays so the server-rendered profile page itself
 * stays a plain server component.
 */
export function ProfileStoryRing({
  userId,
  avatarUrl,
  name,
  stories,
  isOwner,
  currentUserId,
  online,
  initialStoryId,
}: {
  userId: string;
  avatarUrl: string | null;
  name: string;
  stories: StoryData[];
  isOwner: boolean;
  currentUserId: string;
  online?: boolean;
  /**
   * From a notification's `?story=<id>` deep link (see notification-row.tsx's
   * hrefFor) — if it matches one of `stories`, the viewer opens immediately
   * at that story instead of waiting for a tap on the ring. Silently
   * ignored (findIndex returns -1, treated the same as "no deep link") if
   * the story has since expired or been deleted — it simply won't be in
   * `stories`, same "the thing this linked to is gone" fallback every other
   * notification target in this app already gets.
   */
  initialStoryId?: string;
}) {
  const initialIndex = initialStoryId ? stories.findIndex((s) => s.id === initialStoryId) : -1;
  const [viewerOpen, setViewerOpen] = useState(initialIndex >= 0);
  const [startIndex, setStartIndex] = useState(Math.max(initialIndex, 0));
  const [uploadOpen, setUploadOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const hasStories = stories.length > 0;

  return (
    <>
      <div className="relative h-16 w-16 shrink-0">
        {!hasStories && !avatarUrl ? (
          // Nothing to open (no story, no photo to enlarge) — so not a
          // button at all, rather than a permanently disabled one that
          // VoiceOver still announces and Voice Control still numbers.
          <div
            role="img"
            aria-label={`${name} has no profile photo`}
            className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-line bg-surface text-xs text-foreground-soft"
          >
            No photo
          </div>
        ) : (
        <button
          type="button"
          // Stories take priority when present (they're the time-sensitive
          // content); otherwise tapping the photo just enlarges it for a
          // clearer look, rather than being a dead tap like before. Always
          // starts at the first story on a manual tap — startIndex only
          // points elsewhere when the viewer auto-opened from a deep link.
          onClick={() => {
            if (hasStories) {
              setStartIndex(0);
              setViewerOpen(true);
            } else {
              setPhotoOpen(true);
            }
          }}
          aria-label={hasStories ? `View ${name}'s story` : `Enlarge ${name}'s profile photo`}
          className={cn(
            "h-16 w-16 overflow-hidden rounded-full border bg-surface",
            hasStories ? "border-2 border-accent" : "border border-line",
          )}
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-foreground-soft">
              No photo
            </div>
          )}
        </button>
        )}
        {isOwner && (
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            aria-label="Add to your story"
            className="absolute -bottom-1 -right-1 rounded-full border-2 border-background bg-accent p-1 text-accent-ink"
          >
            <Plus size={12} />
          </button>
        )}
        {/* Owner always sees the "+" add-story button in this same corner
            instead — no reason to show yourself as online. */}
        {!isOwner && online && (
          <span
            className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-background bg-success"
            role="img"
            aria-label="Online"
            title="Online"
          />
        )}
      </div>

      {viewerOpen && hasStories && (
        <StoryViewer
          stories={stories}
          startIndex={startIndex}
          authorId={userId}
          authorName={name}
          authorAvatarUrl={avatarUrl}
          isOwner={isOwner}
          currentUserId={currentUserId}
          onClose={() => setViewerOpen(false)}
        />
      )}

      <StoryUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />

      {photoOpen && avatarUrl && (
        <Lightbox
          images={[avatarUrl]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => setPhotoOpen(false)}
          alt={`${name}'s profile photo`}
        />
      )}
    </>
  );
}
