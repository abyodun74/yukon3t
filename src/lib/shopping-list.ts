/**
 * Shopping list for chat (pure, client-safe; tests in shopping-list.test.ts).
 *
 * The composer's "Shopping list" sheet (ShoppingListSheet) builds a list. It always goes through sendMessage, the
 * normal send path (rate limit, membership, blocks, hidden-chat lock, moderation, push). Outside a secret chat it
 * becomes a shared checklist message (see the second half of this file); inside one, the plain text that
 * formatShoppingList builds, encrypted like any typed message.
 *
 * Limits are counted in UTF-16 code units (what `maxLength` on an input and zod's `.max()` count), cut without ever
 * splitting a surrogate pair. Worst case: 2 + 40 + 30 * (1 + 2 + 80) = 2,532 units, well under the 4,000 that
 * messageSchema (src/lib/validations.ts) allows. A secret chat's tighter byte limit (E2EE_MAX_PLAINTEXT_BYTES) is
 * still checked by the composer's send path like any other text.
 */

export const SHOPPING_LIST_TITLE_MAX = 40;
export const SHOPPING_LIST_ITEM_MAX = 80;
export const SHOPPING_LIST_MAX_ITEMS = 30;

/** Header marker before the title, and the empty box before each item. */
export const SHOPPING_LIST_HEADER_MARK = "🛒";
export const SHOPPING_LIST_ITEM_MARK = "☐";

/** Collapses every run of whitespace (newlines included) to one space and trims: one row stays one line. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Cuts `text` to at most `max` UTF-16 code units, never leaving half a surrogate pair at the end. */
export function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut;
}

/** One cleaned row: a single line, trimmed, within SHOPPING_LIST_ITEM_MAX. Empty means "skip it". */
export function cleanShoppingListItem(item: string): string {
  return clampText(oneLine(item), SHOPPING_LIST_ITEM_MAX).trim();
}

/** The rows that will be sent: cleaned, empty ones dropped, at most SHOPPING_LIST_MAX_ITEMS. */
export function shoppingListItems(items: readonly string[]): string[] {
  return items.map(cleanShoppingListItem).filter((item) => item.length > 0).slice(0, SHOPPING_LIST_MAX_ITEMS);
}

/**
 * The message text: a header line with the title (or `defaultTitle` when it is blank), then one "☐ item" line per
 * non-empty row. Returns "" when there is no item, so an empty list is never sent.
 */
export function formatShoppingList(title: string, items: readonly string[], defaultTitle: string): string {
  const rows = shoppingListItems(items);
  if (rows.length === 0) return "";
  const heading = clampText(oneLine(title), SHOPPING_LIST_TITLE_MAX).trim() || clampText(oneLine(defaultTitle), SHOPPING_LIST_TITLE_MAX).trim();
  const header = heading ? `${SHOPPING_LIST_HEADER_MARK} ${heading}` : SHOPPING_LIST_HEADER_MARK;
  return [header, ...rows.map((row) => `${SHOPPING_LIST_ITEM_MARK} ${row}`)].join("\n");
}

// ---------- Checklist messages (shared, tick-able lists; src/app/actions/checklists.ts) ----------
//
// Outside a secret chat the list is sent as a checklist message: a ChecklistMessage row with one ChecklistItem per
// row, that every member of the chat can tick, untick, add to, edit and trim. Its Message.content holds only
// checklistFallbackText(title), which is what the inbox preview, push notifications and anything else that reads a
// message as text show. In a secret (E2EE) chat the server can't hold readable items, so the composer sends
// formatShoppingList's plain text through the normal encrypted path instead, with nothing on screen to tell the two
// apart before sending.

/** The list as the chat thread renders it (what CHECKLIST_SELECT reads). */
export type ChecklistItemData = { id: string; text: string; checkedAt: Date | null; checkedById: string | null };
export type ChecklistData = { id: string; title: string; items: ChecklistItemData[] };

/** What every message query that reaches a chat thread selects for its checklist: rows in list order, nothing else. */
// Not `as const` as a whole: Prisma's orderBy takes a mutable array.
export const CHECKLIST_SELECT = {
  select: {
    id: true as const,
    title: true as const,
    items: {
      orderBy: [{ position: "asc" as const }, { createdAt: "asc" as const }],
      select: { id: true as const, text: true as const, checkedAt: true as const, checkedById: true as const },
    },
  },
};

/** Message.content of a checklist message: the header line only, so a preview never goes stale as the list changes. */
export function checklistFallbackText(title: string): string {
  return `${SHOPPING_LIST_HEADER_MARK} ${title}`;
}

/** The cleaned title, or null when there is none (the composer always sends one: its own default when left blank). */
export function cleanChecklistTitle(title: string): string | null {
  const cleaned = clampText(oneLine(title), SHOPPING_LIST_TITLE_MAX).trim();
  return cleaned || null;
}

/** A new checklist as the server stores it, or null when it has no title or no item left after cleaning. */
export function normalizeChecklistInput(input: { title: string; items: readonly string[] }): { title: string; items: string[] } | null {
  const title = cleanChecklistTitle(input.title);
  const items = shoppingListItems(input.items);
  if (!title || items.length === 0) return null;
  return { title, items };
}

/** All of a new checklist's text in one string, for one moderation call. */
export function checklistModerationText(title: string, items: readonly string[]): string {
  return [title, ...items].join("\n");
}

/** "3 of 8": how many rows are ticked. */
export function checklistProgress(items: readonly { checkedAt: Date | string | null }[]): { done: number; total: number } {
  return { done: items.filter((item) => item.checkedAt !== null).length, total: items.length };
}

/** Whether another row fits (the same SHOPPING_LIST_MAX_ITEMS cap as the editor). */
export function canAddChecklistItem(itemCount: number): boolean {
  return itemCount < SHOPPING_LIST_MAX_ITEMS;
}

/** The advisory-lock key that serialises adding rows to one checklist (count check + next position). */
export function checklistLockKey(checklistId: string): string {
  return `checklist:${checklistId}`;
}
