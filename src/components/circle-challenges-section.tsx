"use client";

import { useCallback, useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { listCircleChallenges } from "@/app/actions/challenges";
import { useChallengesText } from "@/components/challenges-text";
import { ChallengeCreateForm, ChallengeList } from "@/components/challenge-list";
import type { ChallengeView } from "@/lib/challenges-data";
import { byCode } from "@/lib/i18n/locales";

/**
 * A Circle's Challenges (Gift Universe Phase B): the `#challenges` anchor. Mounted by the Circle page for members only,
 * and only when challengesEnabledFor says challenges are on for the viewer; listCircleChallenges re-checks both. Open
 * challenges and ones decided or cancelled in the last week, with join / leave for members and, for the Circle's owner
 * and co-admins, start / declare / change (24h) / cancel.
 */
export function CircleChallengesSection({ circleId }: { circleId: string }) {
  const { locale, dir, t } = useChallengesText();
  const [challenges, setChallenges] = useState<ChallengeView[] | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    listCircleChallenges(circleId)
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
  }, [circleId, version, t]);

  // Links to #challenges (a winner's notification) land here once the list has loaded.
  const loaded = challenges !== null;
  useEffect(() => {
    if (!loaded || window.location.hash !== "#challenges") return;
    requestAnimationFrame(() => document.getElementById("challenges")?.scrollIntoView({ block: "start" }));
  }, [loaded]);

  return (
    <section id="challenges" lang={locale} dir={dir} aria-labelledby="challenges-heading" className="mt-6 space-y-3">
      <h2 id="challenges-heading" className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-foreground-soft">
        <Trophy size={14} aria-hidden="true" />
        {t.heading}
      </h2>
      <p className="text-xs text-foreground-soft">{t.intro}</p>
      {canCreate && <ChallengeCreateForm place={{ context: "CIRCLE", circleId }} onCreated={reload} />}
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
    </section>
  );
}
