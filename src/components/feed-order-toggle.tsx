"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import { useFeedText } from "@/components/feed-text";
import { cn } from "@/lib/utils";
import { hapticSelection } from "@/lib/haptics";
import { FEED_ORDER_COOKIE, FEED_ORDER_COOKIE_MAX_AGE_SECONDS, type FeedOrder } from "@/lib/feed-rotation";

// Plain top-level function, not part of the component body: the React Compiler's immutability check otherwise flags a
// cookie write even from inside an event handler (same as theme-toggle.tsx).
function persistFeedOrder(order: FeedOrder) {
  document.cookie = `${FEED_ORDER_COOKIE}=${order}; path=/; max-age=${FEED_ORDER_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

/**
 * The "Latest" switch on Home and Muse. Off (the default): the feed is a fresh mix every 15 minutes
 * (src/lib/feed-rotation.ts). On: newest first. One cookie for both feeds, read on the server during SSR
 * (getFeedOrder), so the first page already comes in the chosen order; switching re-renders the page from the top.
 */
export function FeedOrderToggle({ order, surface }: { order: FeedOrder; surface: "home" | "muse" }) {
  const { t } = useFeedText();
  const router = useRouter();
  const [latest, setLatest] = useState(order === "latest");
  const [pending, startTransition] = useTransition();
  const hintId = useId();

  function toggle() {
    const next = !latest;
    hapticSelection();
    setLatest(next);
    persistFeedOrder(next ? "latest" : "mixed");
    startTransition(() => router.refresh());
  }

  const onMuse = surface === "muse";
  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={latest}
        aria-describedby={hintId}
        aria-busy={pending || undefined}
        onClick={toggle}
        className={cn(
          "inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-xs font-medium transition-colors",
          onMuse
            ? "bg-black/40 text-white"
            : cn("border", latest ? "border-accent bg-accent-soft text-accent" : "border-line text-foreground-soft hover:text-foreground"),
          pending && "opacity-70",
        )}
      >
        <Clock size={14} strokeWidth={2.25} aria-hidden />
        <span>{t.feedOrder.latest}</span>
        {/* The switch itself: a small track whose knob sits at the end when Latest is on. */}
        <span
          aria-hidden
          className={cn(
            "relative inline-block h-4 w-7 rounded-full transition-colors",
            latest ? (onMuse ? "bg-white" : "bg-accent") : onMuse ? "bg-white/30" : "bg-line",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-3 w-3 rounded-full transition-[inset-inline-start] duration-200 ease-out motion-reduce:transition-none",
              latest ? "start-3.5" : "start-0.5",
              latest && onMuse ? "bg-black" : "bg-white",
            )}
          />
        </span>
      </button>
      {/* Outside the button so it describes the switch without becoming part of its name. */}
      <span id={hintId} className="sr-only">
        {onMuse ? t.feedOrder.museHint : t.feedOrder.homeHint}
      </span>
    </>
  );
}
