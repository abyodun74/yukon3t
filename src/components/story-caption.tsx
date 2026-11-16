"use client";

import { cn } from "@/lib/utils";
import { useShellText } from "@/components/ui-text";
import { STORY_CAPTION_COLLAPSED_CHARS } from "@/lib/story-text";

/**
 * A story's caption over the dark gradient: about three lines until "Show more" is tapped, then the whole text in a
 * scrollable box. The expanded state lives in the viewer (keyed by story id, so it resets on the next story, and it
 * holds the story's timer while open); this is purely presentational. The toggle sits above the tap zones in the
 * viewer's chrome layer, so tapping it never navigates.
 */
export function StoryCaption({
  text,
  expanded,
  onToggle,
  className,
}: {
  text: string;
  expanded: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const { t } = useShellText();
  const long = text.length > STORY_CAPTION_COLLAPSED_CHARS || text.split("\n").length > 3;
  return (
    <div className={className}>
      <p
        dir="auto"
        className={cn(
          "whitespace-pre-line break-words text-sm text-white [overflow-wrap:anywhere]",
          long && !expanded && "line-clamp-3",
          expanded && "max-h-[40dvh] overflow-y-auto",
        )}
      >
        {text}
      </p>
      {long && (
        <button
          type="button"
          onClick={onToggle}
          onPointerDown={(e) => e.stopPropagation()}
          aria-expanded={expanded}
          className="mt-1 text-sm font-semibold text-white underline underline-offset-2"
        >
          {expanded ? t.text.showLess : t.text.showMore}
        </button>
      )}
    </div>
  );
}
