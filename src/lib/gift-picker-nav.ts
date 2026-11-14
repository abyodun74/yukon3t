import type { GiftUniverseName } from "@/lib/gifts-data";

// The gift picker's section navigation (src/components/gift-picker-sheet.tsx): which sections exist, their element
// ids, which chip is "current" while the list scrolls, and where to scroll to when a chip is tapped. Pure and
// client-safe, so the rules are unit-tested without a DOM.

export type GiftPickerSectionKey = "right-now" | "kind-words" | `universe-${Lowercase<GiftUniverseName>}`;

export type GiftPickerSection =
  | { key: "right-now"; kind: "rightNow" }
  | { key: "kind-words"; kind: "kindWords" }
  | { key: GiftPickerSectionKey; kind: "universe"; universe: GiftUniverseName };

/** The DOM id of a section (the chip's aria-controls and scroll target). */
export function giftSectionId(key: GiftPickerSectionKey): string {
  return `gift-section-${key}`;
}

export function universeSectionKey(universe: GiftUniverseName): GiftPickerSectionKey {
  return `universe-${universe.toLowerCase() as Lowercase<GiftUniverseName>}`;
}

/** The sections in the order the picker renders them: "Right now" (when an occasion applies), the free kind words
 * (when any), then each universe the server returned. */
export function giftPickerSections(shelves: {
  rightNow: unknown | null | undefined;
  kindWords: readonly unknown[];
  universes: readonly { universe: GiftUniverseName }[];
}): GiftPickerSection[] {
  const sections: GiftPickerSection[] = [];
  if (shelves.rightNow) sections.push({ key: "right-now", kind: "rightNow" });
  if (shelves.kindWords.length > 0) sections.push({ key: "kind-words", kind: "kindWords" });
  for (const { universe } of shelves.universes) sections.push({ key: universeSectionKey(universe), kind: "universe", universe });
  return sections;
}

/** How far below the scroll region's top edge a section's top may sit and still count as "the one being read". */
export const GIFT_SPY_THRESHOLD_PX = 24;
/** The gap left above a section header when a chip scrolls to it (the `scroll-mt` of each section). */
export const GIFT_SECTION_SCROLL_MARGIN_PX = 8;

/**
 * The section currently in view (scroll-spy). `sections` are in render order with each top measured relative to the
 * scroll content (offset from the region's own top plus its scrollTop). At the very bottom of the list the last
 * section wins even if it is too short to ever reach the top; otherwise the last section whose top has reached the
 * threshold line; before any has, the first one.
 */
export function activeGiftSection(
  sections: readonly { key: GiftPickerSectionKey; top: number }[],
  scroll: { scrollTop: number; clientHeight: number; scrollHeight: number },
  threshold = GIFT_SPY_THRESHOLD_PX,
): GiftPickerSectionKey | null {
  if (sections.length === 0) return null;
  if (scroll.scrollHeight - scroll.clientHeight > 1 && scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2) {
    return sections[sections.length - 1].key;
  }
  let active = sections[0].key;
  for (const section of sections) {
    if (section.top <= scroll.scrollTop + threshold) active = section.key;
    else break;
  }
  return active;
}

/** The scrollTop that puts a section's top just under the region's top edge, from on-screen rects. Never negative. */
export function giftSectionScrollTop(
  sectionRectTop: number,
  regionRectTop: number,
  currentScrollTop: number,
  margin = GIFT_SECTION_SCROLL_MARGIN_PX,
): number {
  return Math.max(0, Math.round(currentScrollTop + sectionRectTop - regionRectTop - margin));
}

/** Smooth for everyone except people who asked for reduced motion. */
export function giftScrollBehavior(prefersReducedMotion: boolean): ScrollBehavior {
  return prefersReducedMotion ? "auto" : "smooth";
}

/** Tapping a gift selects it; tapping the selected gift again clears the choice. */
export function toggleGiftSelection(current: string | null, sku: string): string | null {
  return current === sku ? null : sku;
}

/**
 * How much of the layout viewport the on-screen keyboard covers (iOS keeps the layout viewport and shrinks only the
 * visual one; Android WebView usually resizes both, giving 0 here and leaving it to `dvh`). Below a small threshold
 * (browser chrome jitter) it is treated as no keyboard.
 */
export function keyboardInset(viewport: { innerHeight: number; height: number; offsetTop: number }): number {
  const inset = Math.round(viewport.innerHeight - viewport.height - viewport.offsetTop);
  return inset > 60 ? inset : 0;
}

/**
 * How far to scroll the chip row horizontally so the current chip is fully visible, from on-screen rects (physical
 * left/right). Positive scrolls right, negative left; scrollBy uses physical directions in RTL too, so this is the same
 * for Arabic. 0 when the chip is already visible.
 */
export function chipScrollDelta(chip: { left: number; right: number }, row: { left: number; right: number }, pad = 16): number {
  if (chip.right - chip.left >= row.right - row.left - 2 * pad) return Math.round(chip.left - row.left - pad);
  if (chip.left < row.left + pad) return Math.round(chip.left - row.left - pad);
  if (chip.right > row.right - pad) return Math.round(chip.right - row.right + pad);
  return 0;
}
