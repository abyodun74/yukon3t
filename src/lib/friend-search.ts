/**
 * Client-side search over a list of people (the "Send to a friend" pickers, the add-to-call sheet). Pure, so it can be
 * unit-tested and shared by every picker instead of each one hand-rolling `toLowerCase().includes()`.
 *
 * Matching is case-insensitive and diacritic-insensitive ("Jose" finds "José", "Zoe" finds "Zoë"), works on any
 * script (Arabic and CJK names pass through unchanged, only combining marks are dropped), and ignores surrounding
 * whitespace. A leading "@" in the query is ignored so "@jo" finds the username "jo".
 */

/** Lower-cases, NFD-normalizes and strips combining marks (accents, Arabic tashkeel), then trims. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .trim();
}

/** The normalized form of what the user typed: no surrounding spaces, no leading "@". */
export function normalizeSearchQuery(query: string): string {
  return normalizeSearchText(query).replace(/^@+/, "").trim();
}

/**
 * Items whose name or username contains the query. An empty (or whitespace/"@"-only) query returns every item
 * untouched, in the original order.
 */
export function filterBySearch<T>(
  items: readonly T[],
  query: string,
  getFields: (item: T) => ReadonlyArray<string | null | undefined>,
): T[] {
  const needle = normalizeSearchQuery(query);
  if (needle === "") return [...items];
  return items.filter((item) =>
    getFields(item).some((field) => field != null && normalizeSearchText(field).includes(needle)),
  );
}
