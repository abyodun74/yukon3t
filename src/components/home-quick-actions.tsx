"use client";

import { useCallback, useState } from "react";
import { Plus, ImagePlus, Radio } from "lucide-react";
import { getActiveLiveStreams } from "@/app/actions/live-streams";
import { usePolling } from "@/lib/use-polling";
import { ScrollFab } from "@/components/scroll-fab";

const LIVE_POLL_INTERVAL_MS = 20000;

function goTo(sectionId: string, focusTextarea?: boolean) {
  const target = document.getElementById(sectionId);
  target?.scrollIntoView({ behavior: "smooth", block: "center" });
  if (focusTextarea) {
    // A short delay so focus lands after the scroll settles rather than
    // yanking the viewport back up mid-animation (the same reason a
    // native `<a href="#anchor">` jump doesn't fight a focus() call).
    window.setTimeout(() => target?.querySelector("textarea")?.focus(), 300);
  }
}

/**
 * Home's floating action button: hidden while the real composer
 * (#home-composer) is on screen, expands into three shortcuts (Live / Add
 * story / New post) that scroll their section back into view rather than
 * reimplementing any of LiveStreamStrip/StoryTray/PostComposer's own logic.
 * The Live shortcut's badge reflects whether a stream is actually live
 * right now (polls the same action LiveStreamStrip itself uses).
 */
export function HomeQuickActions() {
  const [liveCount, setLiveCount] = useState(0);

  const pollLive = useCallback(async () => {
    const { streams } = await getActiveLiveStreams();
    setLiveCount(streams.length);
  }, []);
  usePolling(pollLive, LIVE_POLL_INTERVAL_MS);

  return (
    <ScrollFab
      hideWhileVisibleId="home-composer"
      actions={[
        {
          key: "live",
          label: "Live",
          icon: <Radio size={16} />,
          iconClassName: "bg-danger text-white",
          badge: liveCount > 0 && (
            <span className="unread-dot absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-white" />
          ),
          onSelect: () => goTo("home-live-section"),
        },
        {
          key: "story",
          label: "Add story",
          icon: <ImagePlus size={16} />,
          iconClassName: "bg-teal text-white",
          onSelect: () => goTo("home-story-tray"),
        },
        {
          key: "post",
          label: "New post",
          icon: <Plus size={16} />,
          iconClassName: "bg-accent text-accent-ink",
          onSelect: () => goTo("home-composer", true),
        },
      ]}
    />
  );
}
