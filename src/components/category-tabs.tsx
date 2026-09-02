"use client";

import { useLayoutEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { feedCategoryValues, feedCategoryLabels } from "@/lib/validations";
import { cn } from "@/lib/utils";

// Home's tab strip deliberately orders these differently from
// validations.ts's canonical feedCategoryValues — that array also drives
// the composer's category picker and mirrors the Prisma enum, neither of
// which this reorder is about, so it stays untouched. "All" is synthetic,
// not part of the enum.
const TAB_ORDER: (typeof feedCategoryValues)[number][] = [
  "HEALTH_WELLNESS",
  "RELIGIOUS_SPIRITUAL",
  "FINANCIAL_TIPS",
  "SPORTS",
  "NEWS",
  "ENTERTAINMENT",
  "MOTIVATIONAL",
  "POLITICS",
  "OCCUPATIONAL",
  "EDUCATIONAL",
  "GENERAL",
];

const SWIPE_THRESHOLD_PX = 50;

/**
 * Single-row, swipeable category strip for Home — replaces the old wrapped
 * pill grid. Tapping a tab (or swiping left/right anywhere on the strip)
 * both wrap around the same cycle: All → Health & Wellness → ... → General
 * → All, matching the bottom tab bar's own swipe convention in nav.tsx
 * (swipe right steps forward, swipe left steps backward). The active tab
 * gets a sliding underline and auto-centers itself in view instead of the
 * row just snapping between states.
 */
export function CategoryTabs({
  category,
  allPostsScope,
}: {
  category: string | null;
  allPostsScope: boolean;
}) {
  const router = useRouter();
  const scopeQuery = allPostsScope ? "&scope=all" : "";

  const tabs = [
    { key: "all", label: "All", href: `/home${allPostsScope ? "?scope=all" : ""}` },
    ...TAB_ORDER.map((cat) => ({
      key: cat as string,
      label: feedCategoryLabels[cat],
      href: `/home?category=${cat}${scopeQuery}`,
    })),
  ];

  const activeIndex = Math.max(
    0,
    tabs.findIndex((t) => t.key === (category ?? "all")),
  );

  const tabRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = tabRefs.current[activeIndex];
    const indicator = indicatorRef.current;
    if (!el || !indicator) return;
    indicator.style.width = `${el.offsetWidth}px`;
    indicator.style.transform = `translateX(${el.offsetLeft}px)`;
    el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeIndex]);

  function onTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    // Owns this gesture outright — stopping propagation keeps nav.tsx's
    // document-level swipe listener (which flips the bottom Home/Circles/…
    // tab) from also reacting to a swipe that started on this strip.
    e.stopPropagation();
    const touch = e.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    e.stopPropagation();
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dy) > Math.abs(dx)) return;
    const delta = dx > 0 ? 1 : -1;
    const next = (activeIndex + delta + tabs.length) % tabs.length;
    router.push(tabs[next].href);
  }

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="relative flex gap-1.5 overflow-x-auto pb-2 scroll-smooth"
    >
      {tabs.map((tab, i) => (
        <Link
          key={tab.key}
          href={tab.href}
          ref={(node) => {
            tabRefs.current[i] = node;
          }}
          className={cn(
            "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-300",
            i === activeIndex
              ? "border-accent bg-accent-soft text-accent"
              : "border-line text-foreground-soft",
          )}
        >
          {tab.label}
        </Link>
      ))}
      <span
        ref={indicatorRef}
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 h-0.5 rounded-full bg-accent transition-[transform,width] duration-300 ease-out"
      />
    </div>
  );
}
