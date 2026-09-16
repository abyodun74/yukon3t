"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ImagePlus, Radio } from "lucide-react";
import { getActiveLiveStreams } from "@/app/actions/live-streams";
import { useRealtimeEvent } from "@/lib/realtime-client";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { ScrollFab } from "@/components/scroll-fab";

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
 * Home's floating action button: hidden while the story tray is on screen,
 * expands into three shortcuts (Live / Add story / New post) — Live and Add
 * story scroll their own section back into view rather than reimplementing
 * any of LiveStreamStrip/StoryTray's own logic, while New post navigates to
 * the viewer's own profile (posting only happens from there — see
 * ProfileComposeFocus, which scrolls to and focuses the composer on
 * arrival). The Live shortcut's badge reflects whether a stream is actually
 * live right now (fetches the same action LiveStreamStrip itself uses,
 * refetching on the same global realtime channel LiveStreamStrip subscribes
 * to rather than its own independent poll).
 */
export function HomeQuickActions({ profileHref }: { profileHref: string }) {
  const [liveCount, setLiveCount] = useState(0);
  const router = useRouter();

  const refetchLive = useCallback(async () => {
    const { streams } = await getActiveLiveStreams();
    setLiveCount(streams.length);
  }, []);

  const refetchLiveRef = useRef(refetchLive);
  useEffect(() => {
    refetchLiveRef.current = refetchLive;
  });
  useEffect(() => {
    refetchLiveRef.current();
  }, []);
  useRealtimeEvent(REALTIME_CHANNELS.liveStreams(), "changed", refetchLive);

  return (
    <ScrollFab
      hideWhileVisibleId="home-story-tray"
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
          onSelect: () => router.push(`${profileHref}?compose=1`),
        },
      ]}
    />
  );
}
