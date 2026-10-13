"use client";

import { ShieldCheck, BadgeCheck, Sparkle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFeedText } from "@/components/feed-text";

const styles: Record<string, string> = {
  TRUSTED: "text-success",
  ESTABLISHED: "text-teal",
  NEW: "text-foreground-soft",
};

const icons: Record<string, typeof ShieldCheck> = {
  TRUSTED: ShieldCheck,
  ESTABLISHED: BadgeCheck,
  NEW: Sparkle,
};

/**
 * A single small icon instead of a text pill ("Trusted"/"Established"/"New
 * member") — the label still exists as title/aria-label (a tap-and-hold or
 * screen reader still gets the real word), but doesn't claim its own
 * horizontal space in a post/comment header, which is what was actually
 * squeezing a long display name into overlapping the timestamp/menu next
 * to it (see post-card.tsx's header row).
 */
export function TrustBadge({ band }: { band: string }) {
  const Icon = icons[band] ?? icons.NEW;
  const { t } = useFeedText();
  const trust: Record<string, string> = t.people.trust;
  const label = trust[band] ?? trust.NEW;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center", styles[band] ?? styles.NEW)}
      title={label}
      role="img"
      aria-label={label}
    >
      <Icon size={15} strokeWidth={2.25} aria-hidden="true" />
    </span>
  );
}
