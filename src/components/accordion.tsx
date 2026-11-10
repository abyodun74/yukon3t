// The look shared by every expandable list in the app: the FAQ's questions (native <details>) and the Settings
// sections (CollapsibleSection, a button with aria-expanded). Plain markup, so server and client components can both
// use it. The element that opens and closes carries ACCORDION_GROUP; the indicator follows it with CSS alone (the
// details' [open], or the button's aria-expanded="true"), so it can never disagree with the real state.

/** Class for the element whose state the indicator shows: a <details>, or the toggle <button>. */
export const ACCORDION_GROUP = "group/accordion";

/** The card around one item (FAQ question, Settings section). */
export const ACCORDION_CARD = "rounded-xl border border-line bg-surface";

/** The clickable heading text of one item. */
export const ACCORDION_LABEL = "text-sm font-medium";

/** The "+" (closed) / "−" (open) sign at the end of an item's heading. Decorative: the state is announced by the
 * details element or by aria-expanded, so it is hidden from assistive technology. No animation, so nothing to reduce. */
export function AccordionIndicator() {
  return (
    <span aria-hidden="true" className="shrink-0 text-foreground-soft">
      <span className="group-open/accordion:hidden group-aria-expanded/accordion:hidden">+</span>
      <span className="hidden group-open/accordion:inline group-aria-expanded/accordion:inline">−</span>
    </span>
  );
}
