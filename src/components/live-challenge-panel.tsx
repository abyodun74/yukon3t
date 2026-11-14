"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trophy } from "lucide-react";
import { listLiveChallenges } from "@/app/actions/challenges";
import { useChallengesText } from "@/components/challenges-text";
import { ChallengeCreateForm, ChallengeList } from "@/components/challenge-list";
import { Sheet } from "@/components/sheet";
import type { ChallengeView } from "@/lib/challenges-data";
import { createTrailingThrottle } from "@/lib/live-stream-signal";
import { byCode } from "@/lib/i18n/locales";

/** At most one signal-driven refetch of the open panel per this long (joins can come in bursts). */
const PANEL_REFETCH_MS = 2_000;

/**
 * The live room's challenges (Gift Universe Phase B): a trophy button that opens a sheet listing this stream's
 * challenges, where the host starts one and declares winners, and viewers in the room join or leave. Rendered only
 * when challengesEnabledFor is on for the viewer (src/app/live/[id]/page.tsx); every action re-checks it, and that the
 * viewer is in the stream. `signal` is bumped by each "challenge" live-stream signal; the open sheet refetches then
 * (throttled). Like the gift picker, the Sheet opens one layer above the room's controls (LiveStreamRoom's OverlayLayerProvider), above the video.
 */
export function LiveChallengePanel({
  liveStreamId,
  signal,
  className,
}: {
  liveStreamId: string;
  signal: number;
  className?: string;
}) {
  const { locale, dir, t } = useChallengesText();
  const [open, setOpen] = useState(false);
  const [challenges, setChallenges] = useState<ChallengeView[] | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const throttle = useMemo(() => createTrailingThrottle(reload, PANEL_REFETCH_MS), [reload]);
  useEffect(() => () => throttle.cancel(), [throttle]);

  // A "challenge" signal while the sheet is open: refetch (throttled). Closed: the next open fetches anyway.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });
  useEffect(() => {
    if (openRef.current) throttle.trigger();
  }, [signal, throttle]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    listLiveChallenges(liveStreamId)
      .then((result) => {
        if (cancelled) return;
        if (result.error) {
          setError(byCode(t.errors, result.error));
          return;
        }
        setError(null);
        setChallenges(result.challenges);
        setCanCreate(result.canCreate);
      })
      .catch(() => {
        if (!cancelled) setError(t.loadFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [open, liveStreamId, version, t]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={t.liveButton} className={className}>
        <Trophy size={16} aria-hidden="true" />
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        variant="bottom-sheet"
        responsive
        title={t.heading}
        lang={locale}
        dir={dir}
        panelClassName="max-w-md"
      >
        <div className="mt-2 max-h-[70vh] space-y-3 overflow-y-auto pb-2">
          <p className="text-xs text-foreground-soft">{t.liveIntro}</p>
          {canCreate && <ChallengeCreateForm place={{ context: "LIVE", liveStreamId }} onCreated={reload} />}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}{" "}
              <button type="button" onClick={reload} className="underline">
                {t.retry}
              </button>
            </p>
          ) : challenges === null ? (
            <p className="text-sm text-foreground-soft">{t.loading}</p>
          ) : (
            <ChallengeList challenges={challenges} onChanged={reload} />
          )}
        </div>
      </Sheet>
    </>
  );
}
