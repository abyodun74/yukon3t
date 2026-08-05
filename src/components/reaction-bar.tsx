"use client";

import { cn } from "@/lib/utils";

export function ReactionBar({
  reactions,
  currentUserId,
  mine = false,
  onToggle,
}: {
  reactions: { emoji: string; userId: string }[];
  currentUserId: string;
  mine?: boolean;
  onToggle: (emoji: string) => void;
}) {
  if (reactions.length === 0) return null;

  const grouped = new Map<string, string[]>();
  for (const r of reactions) {
    grouped.set(r.emoji, [...(grouped.get(r.emoji) ?? []), r.userId]);
  }

  return (
    <div className={cn("mt-1 flex flex-wrap gap-1", mine ? "justify-end" : "justify-start")}>
      {[...grouped.entries()].map(([emoji, userIds]) => {
        const mineReacted = userIds.includes(currentUserId);
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => onToggle(emoji)}
            className={cn(
              "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs",
              mineReacted ? "border-accent bg-accent/10" : "border-line bg-surface hover:bg-line",
            )}
          >
            <span>{emoji}</span>
            {userIds.length > 1 && <span className="text-[10px] text-foreground-soft">{userIds.length}</span>}
          </button>
        );
      })}
    </div>
  );
}
