"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { ACCORDION_CARD, ACCORDION_GROUP, ACCORDION_LABEL, AccordionIndicator } from "@/components/accordion";
import {
  fragmentTargetId,
  openSectionsStorageKey,
  parseOpenSections,
  samePageFragmentTarget,
  withSectionOpen,
} from "@/lib/collapsible-sections";

function readOpen(storageKey: string): string[] {
  try {
    return parseOpenSections(window.sessionStorage.getItem(storageKey));
  } catch {
    return [];
  }
}

function rememberOpen(storageKey: string, id: string, open: boolean) {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(withSectionOpen(readOpen(storageKey), id, open)));
  } catch {
    // Private mode / blocked storage: the section just won't be remembered.
  }
}

/**
 * One expandable section of a page (Settings), in the FAQ's look (src/components/accordion.tsx). Starts closed, like
 * every FAQ question. The content stays mounted while closed (only `hidden`), so a half-filled form, a toggle or a
 * picker inside keeps its state when the section is collapsed and reopened.
 *
 * Opens on its own when:
 * - the URL fragment names this section or anything inside it (/settings#birthdays, #sign-in-method), on load and on
 *   every hashchange, then scrolls that element into view;
 * - a same-page link to such a fragment is clicked, even when the URL already has that fragment (no hashchange);
 * - it was open earlier in this tab (sessionStorage, `page`), so saving a form, which reloads the page, doesn't fold the
 *   section the person was working in.
 */
export function CollapsibleSection({
  id,
  page,
  title,
  children,
}: {
  /** The section's anchor (/page#id); also the base of the button and panel ids. Never change one that shipped. */
  id: string;
  /** Which page's remembered state this belongs to (e.g. "settings"). */
  page: string;
  title: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const storageKey = openSectionsStorageKey(page);
  const buttonId = `${id}-toggle`;
  const panelId = `${id}-panel`;

  const toggle = useCallback(() => {
    const next = !open;
    setOpen(next);
    rememberOpen(storageKey, id, next);
  }, [open, id, storageKey]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    // The element `targetId` names, if it is this section or inside it.
    const ownTarget = (targetId: string | null) => {
      if (!targetId) return null;
      const el = document.getElementById(targetId);
      return el && root.contains(el) ? el : null;
    };
    // Scroll after the panel is shown (a hidden element can't be scrolled to). Instant, so reduced motion is respected.
    const reveal = (el: HTMLElement) => {
      window.requestAnimationFrame(() => el.scrollIntoView({ block: "start" }));
    };

    const fromHash = ownTarget(fragmentTargetId(window.location.hash));
    if (fromHash || readOpen(storageKey).includes(id)) {
      // The fragment and sessionStorage only exist after mount; the server render is always closed.
      setOpen(true);
      if (fromHash) {
        rememberOpen(storageKey, id, true);
        reveal(fromHash);
      }
    }

    const onHashChange = () => {
      const el = ownTarget(fragmentTargetId(window.location.hash));
      if (!el) return;
      setOpen(true);
      rememberOpen(storageKey, id, true);
      reveal(el);
    };
    // Capture phase, before the browser follows the link: flushSync shows the panel first, so the browser's own
    // jump to the fragment lands on a visible element.
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      const el = ownTarget(samePageFragmentTarget(link.href, window.location.href));
      if (!el) return;
      flushSync(() => setOpen(true));
      rememberOpen(storageKey, id, true);
      reveal(el);
    };

    window.addEventListener("hashchange", onHashChange);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      document.removeEventListener("click", onClick, true);
    };
  }, [id, storageKey]);

  return (
    <section
      ref={rootRef}
      id={id}
      className={`${ACCORDION_CARD} scroll-mt-24 ${open ? "shadow-sm" : ""}`}
    >
      <h2 className={ACCORDION_LABEL}>
        <button
          type="button"
          id={buttonId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          className={`${ACCORDION_GROUP} flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
        >
          <span className="min-w-0 break-words">{title}</span>
          <AccordionIndicator />
        </button>
      </h2>
      <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!open} className="px-4 pb-4">
        {children}
      </div>
    </section>
  );
}
