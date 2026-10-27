"use client";

import { useState, useTransition } from "react";
import { Bell, BellRing } from "lucide-react";
import { toggleSubscription } from "@/app/actions/subscriptions";
import { cn } from "@/lib/utils";
import { useFeedText } from "@/components/feed-text";

/**
 * One-directional "subscribe" toggle — same optimistic-with-revert shape as
 * handleLike/handleRepost in post-card.tsx. Two render modes: "icon" for the
 * post card action row, "pill" for the subscribers/subscribing list pages.
 */
export function SubscribeButton({
  targetId,
  initiallySubscribed,
  variant = "icon",
}: {
  targetId: string;
  initiallySubscribed: boolean;
  variant?: "icon" | "pill";
}) {
  const { t } = useFeedText();
  const [subscribed, setSubscribed] = useState(initiallySubscribed);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next = !subscribed;
    setSubscribed(next);
    startTransition(async () => {
      const result = await toggleSubscription(targetId);
      if (result.error) {
        setSubscribed(!next);
      }
    });
  }

  if (variant === "pill") {
    return (
      <button data-guest-block
        type="button"
        disabled={isPending}
        onClick={toggle}
        aria-pressed={subscribed}
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50",
          subscribed ? "bg-line text-foreground" : "bg-accent text-accent-ink",
        )}
      >
        {subscribed ? <BellRing size={14} /> : <Bell size={14} />}
        {subscribed ? t.people.subscribed : t.people.subscribe}
      </button>
    );
  }

  return (
    <button data-guest-block
      type="button"
      disabled={isPending}
      onClick={toggle}
      aria-label={t.people.subscribe}
      aria-pressed={subscribed}
      title={subscribed ? t.people.unsubscribe : t.people.subscribe}
      className={cn("flex items-center hover:text-accent", subscribed && "text-accent")}
    >
      {subscribed ? <BellRing size={16} /> : <Bell size={16} />}
    </button>
  );
}
