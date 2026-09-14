"use client";

import { cn } from "@/lib/utils";
import type { ReactionSummary } from "@/lib/reactions";

/** Renders pre-aggregated per-emoji counts — grouping/counting now happens server-side (or, for messages, in summarizeReactionRows), never here. */
export function ReactionBar({
  reactions,
  mine = false,
  onToggle,
}: {
  reactions: ReactionSummary[];
  mine?: boolean;
  onToggle: (emoji: string) => void;
}) {
  if (reactions.length === 0) return null;

  return (
    <div className={cn("mt-1 flex flex-wrap gap-1", mine ? "justify-end" : "justify-start")}>
      {reactions.map(({ emoji, count, reactedByMe }) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onToggle(emoji)}
          className={cn(
            "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs",
            reactedByMe ? "border-accent bg-accent/10" : "border-line bg-surface hover:bg-line",
          )}
        >
          <span>{emoji}</span>
          {count > 1 && <span className="text-[10px] text-foreground-soft">{count}</span>}
        </button>
      ))}
    </div>
  );
}
