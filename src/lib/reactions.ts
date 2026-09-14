// Shared emoji-reaction summary shape, rendered by src/components/reaction-bar.tsx.
// Posts and comments compute this server-side via Prisma's groupBy (see
// src/lib/post-card-data.ts and src/app/actions/comments.ts) so the number
// of distinct reactors never has to travel to the browser as one row each —
// only the per-emoji count does. Messages are the one exception: a
// conversation here is always exactly 2 people (see CLAUDE.md), so a
// message can never have more than 2 reactions total — genuinely unbounded
// growth isn't possible there, so src/components/chat-thread.tsx still
// fetches raw {emoji,userId} rows and uses summarizeReactionRows below to
// adapt them to this same shape at render time instead.
export type ReactionSummary = { emoji: string; count: number; reactedByMe: boolean };

export function summarizeReactionRows(rows: { emoji: string; userId: string }[], viewerId: string): ReactionSummary[] {
  const grouped = new Map<string, { count: number; reactedByMe: boolean }>();
  for (const r of rows) {
    const entry = grouped.get(r.emoji) ?? { count: 0, reactedByMe: false };
    entry.count += 1;
    if (r.userId === viewerId) entry.reactedByMe = true;
    grouped.set(r.emoji, entry);
  }
  return [...grouped.entries()].map(([emoji, v]) => ({ emoji, ...v }));
}
