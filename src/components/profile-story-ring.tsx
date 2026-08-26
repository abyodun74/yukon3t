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
}: {
  userId: string;
  avatarUrl: string | null;
  name: string;
  stories: StoryData[];
  isOwner: boolean;
}) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const hasStories = stories.length > 0;

  return (
    <>
      <div className="relative h-16 w-16 shrink-0">
        <button
          type="button"
          disabled={!hasStories && !avatarUrl}
          // Stories take priority when present (they're the time-sensitive
          // content); otherwise tapping the photo just enlarges it for a
          // clearer look, rather than being a dead tap like before.
          onClick={() => (hasStories ? setViewerOpen(true) : setPhotoOpen(true))}
          aria-label={hasStories ? "View story" : avatarUrl ? "Enlarge profile photo" : undefined}
          className={cn(
            "h-16 w-16 overflow-hidden rounded-full border bg-surface",
            hasStories ? "border-2 border-accent" : "border border-line",
          )}
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-foreground-soft">
              No photo
            </div>
          )}
        </button>
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
      </div>

      {viewerOpen && hasStories && (
        <StoryViewer
          stories={stories}
          startIndex={0}
          authorId={userId}
          authorName={name}
          authorAvatarUrl={avatarUrl}
          isOwner={isOwner}
          onClose={() => setViewerOpen(false)}
        />
      )}

      {uploadOpen && <StoryUploadModal onClose={() => setUploadOpen(false)} />}

      {photoOpen && avatarUrl && (
        <Lightbox images={[avatarUrl]} index={0} onIndexChange={() => {}} onClose={() => setPhotoOpen(false)} />
      )}
    </>
  );
}
