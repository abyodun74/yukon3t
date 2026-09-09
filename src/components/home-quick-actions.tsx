"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, ImagePlus, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { getActiveLiveStreams } from "@/app/actions/live-streams";
import { usePolling } from "@/lib/use-polling";

const LIVE_POLL_INTERVAL_MS = 20000;

/**
 * A floating action button for Home, contextual in two ways: it only
 * appears once the real composer (#home-composer) has scrolled out of view
 * — no point duplicating that affordance while it's already on screen — and
 * its "Live" action carries a pulsing badge whenever a stream is actually
 * live right now, not just a static icon. Expands into three shortcuts
 * (Post / Story / Live) that scroll their section back into view rather
 * than reimplementing any of PostComposer/StoryTray/LiveStreamStrip's own
 * logic — keeps this component decoupled from theirs.
 */
export function HomeQuickActions() {
  const [composerVisible, setComposerVisible] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [liveCount, setLiveCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = document.getElementById("home-composer");
    if (!target) return undefined;
    const observer = new IntersectionObserver(([entry]) => setComposerVisible(entry.isIntersecting), {
      rootMargin: "-64px 0px 0px 0px",
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  const pollLive = useCallback(async () => {
    const { streams } = await getActiveLiveStreams();
    setLiveCount(streams.length);
  }, []);
  usePolling(pollLive, LIVE_POLL_INTERVAL_MS);

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

  function goTo(sectionId: string, focusTextarea?: boolean) {
    const target = document.getElementById(sectionId);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (focusTextarea) {
      // A short delay so focus lands after the scroll settles rather than
      // yanking the viewport back up mid-animation (the same reason a
      // native `<a href="#anchor">` jump doesn't fight a focus() call).
      window.setTimeout(() => target?.querySelector("textarea")?.focus(), 300);
    }
    setExpanded(false);
  }

  const shown = !composerVisible;

  return (
    <div
      ref={containerRef}
      className={cn(
        "fixed bottom-24 right-4 z-[35] flex flex-col items-end gap-2 transition-all duration-200 md:bottom-6 md:right-6",
        shown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
      )}
    >
      {expanded && (
        <div className="flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={() => goTo("home-live-section")}
            className="animate-rise-in flex items-center gap-2 rounded-full bg-surface py-2 pl-4 pr-2 text-sm font-medium text-foreground shadow-[var(--shadow-md)]"
          >
            Live
            <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-danger text-white">
              <Radio size={16} />
              {liveCount > 0 && (
                <span className="unread-dot absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-white" />
              )}
            </span>
          </button>
          <button
            type="button"
            onClick={() => goTo("home-story-tray")}
            className="animate-rise-in flex items-center gap-2 rounded-full bg-surface py-2 pl-4 pr-2 text-sm font-medium text-foreground shadow-[var(--shadow-md)]"
          >
            Add story
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-teal text-white">
              <ImagePlus size={16} />
            </span>
          </button>
          <button
            type="button"
            onClick={() => goTo("home-composer", true)}
            className="animate-rise-in flex items-center gap-2 rounded-full bg-surface py-2 pl-4 pr-2 text-sm font-medium text-foreground shadow-[var(--shadow-md)]"
          >
            New post
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-ink">
              <Plus size={16} />
            </span>
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? "Close quick actions" : "Quick actions"}
        tabIndex={shown ? 0 : -1}
        className={cn(
          "flex h-14 w-14 items-center justify-center rounded-full text-accent-ink shadow-[var(--shadow-md)] transition-transform duration-200",
          expanded ? "rotate-45 bg-foreground-soft" : "bg-accent",
        )}
      >
        <Plus size={24} />
      </button>
    </div>
  );
}
