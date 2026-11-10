// Pure rules behind CollapsibleSection (src/components/collapsible-section.tsx): which sections a page remembers as
// open, and which element a URL fragment points at. Client-safe, no DOM.

/** sessionStorage key prefix; the page's own name follows (e.g. "settings"). Per tab, per viewer: a convenience so a
 * section stays open across a form's save-and-reload, never state anyone else relies on. */
export const OPEN_SECTIONS_STORAGE_PREFIX = "yk.open-sections:";

/** More ids than any page has; a bound so a tampered value can't grow without limit. */
const MAX_REMEMBERED = 50;
const MAX_ID_LENGTH = 100;

export function openSectionsStorageKey(page: string): string {
  return `${OPEN_SECTIONS_STORAGE_PREFIX}${page}`;
}

/** The stored list of open section ids. Anything unreadable (missing, not JSON, not an array of short strings) is
 * treated as "nothing open" rather than throwing. */
export function parseOpenSections(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item.length > MAX_ID_LENGTH) continue;
    if (!ids.includes(item)) ids.push(item);
    if (ids.length >= MAX_REMEMBERED) break;
  }
  return ids;
}

/** The list after opening or closing one section; the original is left untouched. */
export function withSectionOpen(ids: readonly string[], id: string, open: boolean): string[] {
  const rest = ids.filter((existing) => existing !== id);
  return open ? [...rest, id].slice(-MAX_REMEMBERED) : rest;
}

/** The element id a fragment names ("#birthdays" -> "birthdays"), or null for an empty or malformed one. */
export function fragmentTargetId(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  try {
    return decodeURIComponent(raw) || null;
  } catch {
    return null;
  }
}

/** The fragment target of a link clicked on this page, or null when the link goes to another page (or has no
 * fragment). Only same-page links can open a section in place; a link to another page navigates away. */
export function samePageFragmentTarget(href: string, currentHref: string): string | null {
  let target: URL;
  let current: URL;
  try {
    current = new URL(currentHref);
    target = new URL(href, current);
  } catch {
    return null;
  }
  if (target.origin !== current.origin || target.pathname !== current.pathname) return null;
  return fragmentTargetId(target.hash);
}
