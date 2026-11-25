import type { CSSProperties } from "react";
import { LikeHeartArt } from "@/components/like-heart-art";
import type { HeartSpec } from "@/lib/heart-burst";
import { cn } from "@/lib/utils";

/**
 * The floating hearts of a like (useHeartBurst + globals.css `.post-heart-*`), shared by PostCard, the Muse card and
 * the Story viewer. Absolute over its positioned parent, clipped to it, never hit-testable and hidden from assistive
 * tech, so it takes no layout space and never blocks a tap. `heightPx` (measured once per burst) sets --hb-h, the rise
 * distance in px; the layer is remounted per burst (keyed) so a restart replays every heart. Renders nothing between
 * bursts. `className` adds to (or, through tailwind-merge, overrides) the default `z-[1]` stacking.
 */
export function HeartBurstLayer({
  burst,
  className,
}: {
  burst: { key: number | null; hearts: HeartSpec[]; heightPx: number | null };
  className?: string;
}) {
  if (burst.key === null) return null;
  return (
    <span
      key={burst.key}
      aria-hidden="true"
      className={cn("post-heart-layer pointer-events-none absolute inset-0 z-[1] overflow-hidden", className)}
      style={burst.heightPx ? ({ "--hb-h": `${burst.heightPx}px` } as CSSProperties) : undefined}
    >
      {burst.hearts.map((h) => (
        <span
          key={h.id}
          className="post-heart-float"
          data-trail={h.lead ? undefined : ""}
          style={
            {
              left: `calc(50% + ${h.offsetPct}%)`,
              "--hb-sway": `${h.sway}px`,
              "--hb-rot": `${h.rotate}deg`,
              "--hb-rise": h.rise,
              "--hb-dur": `${h.durationMs}ms`,
              "--hb-delay": `${h.delayMs}ms`,
            } as CSSProperties
          }
        >
          {h.lead ? (
            <span className="post-heart-pulse">
              <LikeHeartArt size={h.size} />
            </span>
          ) : (
            <LikeHeartArt size={h.size} />
          )}
        </span>
      ))}
    </span>
  );
}
