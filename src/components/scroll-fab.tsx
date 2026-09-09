"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export type ScrollFabAction = {
  key: string;
  label: string;
  icon: ReactNode;
  iconClassName: string;
  badge?: ReactNode;
  onSelect: () => void;
};

/**
 * Shared shell behind Home/Circles/Messages' floating action buttons:
 * hidden while `hideWhileVisibleId` is on screen (no point duplicating an
 * affordance that's already visible), reappearing once it scrolls out of
 * view. A single action taps directly; more than one expands into a
 * labeled stack first (outside-click or re-tap collapses it). Each page
 * owns what its actions actually do — this only owns the show/hide and
 * expand/collapse mechanics, so it stays decoupled from whatever
 * component `hideWhileVisibleId` belongs to.
 */
export function ScrollFab({
  hideWhileVisibleId,
  actions,
}: {
  hideWhileVisibleId: string;
  actions: ScrollFabAction[];
}) {
  const [targetVisible, setTargetVisible] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const boundTargetRef = useRef<Element | null>(null);

  useEffect(() => {
    let intersectionObserver: IntersectionObserver | null = null;

    // A page can gain or lose `hideWhileVisibleId` without this component
    // itself re-rendering — leaving a Circle swaps its composer out for a
    // "join to post" message, switching to a voice channel removes it
    // entirely. Re-checking on every DOM mutation (not just on mount) is
    // what makes this component correctly disappear again in that case,
    // instead of getting stuck showing a FAB whose action silently no-ops
    // because its target no longer exists.
    function sync() {
      const target = document.getElementById(hideWhileVisibleId);
      if (target && target !== boundTargetRef.current) {
        intersectionObserver?.disconnect();
        intersectionObserver = new IntersectionObserver(([entry]) => setTargetVisible(entry.isIntersecting), {
          rootMargin: "-64px 0px 0px 0px",
        });
        intersectionObserver.observe(target);
        boundTargetRef.current = target;
      } else if (!target && boundTargetRef.current) {
        intersectionObserver?.disconnect();
        intersectionObserver = null;
        boundTargetRef.current = null;
        setTargetVisible(true);
      }
    }

    sync();
    const mutationObserver = new MutationObserver(sync);
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      intersectionObserver?.disconnect();
      mutationObserver.disconnect();
      boundTargetRef.current = null;
    };
  }, [hideWhileVisibleId]);

  useEffect(() => {
    if (!expanded) return undefined;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [expanded]);

  if (actions.length === 0) return null;

  const shown = !targetVisible;
  const multi = actions.length > 1;
  const primary = actions[0];

  function handleMainClick() {
    if (multi) {
      setExpanded((v) => !v);
    } else {
      primary.onSelect();
    }
  }

  function handleActionClick(action: ScrollFabAction) {
    action.onSelect();
    setExpanded(false);
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "fixed bottom-24 right-4 z-[35] flex flex-col items-end gap-2 transition-all duration-200 md:bottom-6 md:right-6",
        shown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
      )}
    >
      {multi && expanded && (
        <div className="flex flex-col items-end gap-2">
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              onClick={() => handleActionClick(action)}
              tabIndex={shown ? 0 : -1}
              className="animate-rise-in flex items-center gap-2 rounded-full bg-surface py-2 pl-4 pr-2 text-sm font-medium text-foreground shadow-[var(--shadow-md)]"
            >
              {action.label}
              <span
                className={cn(
                  "relative flex h-9 w-9 items-center justify-center rounded-full",
                  action.iconClassName,
                )}
              >
                {action.icon}
                {action.badge}
              </span>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={handleMainClick}
        aria-expanded={multi ? expanded : undefined}
        aria-label={multi ? (expanded ? "Close quick actions" : "Quick actions") : primary.label}
        tabIndex={shown ? 0 : -1}
        className={cn(
          "flex h-14 w-14 items-center justify-center rounded-full text-accent-ink shadow-[var(--shadow-md)] transition-transform duration-200",
          multi && expanded ? "rotate-45 bg-foreground-soft" : "bg-accent",
        )}
      >
        {multi ? <Plus size={24} /> : primary.icon}
      </button>
    </div>
  );
}
