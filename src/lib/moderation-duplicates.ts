// Pure rules behind /admin/moderation's "Duplicates" section. Which rows are
// duplicates of each other is decided in the database (see
// moderation-duplicates-data.ts); this decides which one of a set to keep.

/**
 * A duplicate set of DM threads or groups: keeps the most recently active
 * one (its newest message, or its own createdAt when it has none) and
 * offers the rest for deletion, most recently active first. Ties keep the
 * one created first.
 */
export function splitKeeperAndDuplicates<T extends { id: string; createdAt: Date }>(
  conversations: T[],
  lastMessageAt: ReadonlyMap<string, Date>,
): { keeper: T; duplicates: T[] } {
  const lastActive = (c: T) => (lastMessageAt.get(c.id) ?? c.createdAt).getTime();
  const sorted = [...conversations]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .sort((a, b) => lastActive(b) - lastActive(a));
  return { keeper: sorted[0], duplicates: sorted.slice(1) };
}

/**
 * Turns the database's sets of ids back into sets of rows, in the order the
 * ids came in. A row deleted between the grouping query and the detail
 * query is simply missing, so a set left with fewer than two rows is no
 * longer a duplicate and is dropped.
 */
export function rowsByDuplicateSet<T extends { id: string }>(idSets: string[][], rows: T[]): T[][] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return idSets
    .map((ids) => ids.map((id) => byId.get(id)).filter((row): row is T => row !== undefined))
    .filter((set) => set.length > 1);
}
