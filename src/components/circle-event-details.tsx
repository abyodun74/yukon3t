"use client";

import { useEffect, useState } from "react";
import { loadCircleEventDetails } from "@/app/actions/circle-events";
import { CircleEventPanel, type CircleEventChange } from "@/components/circle-event-panel";
import { useUiText } from "@/components/ui-text";
import type { CircleEventPanelData } from "@/lib/circle-events-data";
import { byCode } from "@/lib/i18n/locales";

/**
 * "Event details" opened on a Circle event's card (post-card.tsx), in the Circle's feed or anywhere else the post is
 * listed: loads the same panel /post/[id] shows under the post (calendar, bring list, nudge, repeat, reschedule /
 * cancel for organizers) when opened, so the feed itself loads nothing extra. The server decides access again.
 */
export function CircleEventDetails({
  postId,
  onEventChange,
}: {
  postId: string;
  onEventChange?: (change: CircleEventChange) => void;
}) {
  const { t: ui } = useUiText();
  const t = ui.events;
  const [data, setData] = useState<CircleEventPanelData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCircleEventDetails(postId)
      .then((result) => {
        if (cancelled) return;
        if (result.error) setError(byCode(t.errors, result.error));
        else setData(result.data);
      })
      .catch(() => {
        if (!cancelled) setError(t.errors.network);
      });
    return () => {
      cancelled = true;
    };
    // Loaded once per opening; the panel keeps its own state after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  if (error) {
    return (
      <p role="alert" className="mt-2 text-xs text-danger">
        {error}
      </p>
    );
  }
  if (!data) {
    return (
      <p role="status" className="mt-2 animate-loading-pulse text-xs text-foreground-soft">
        {t.detailsLoading}
      </p>
    );
  }
  return <CircleEventPanel data={data} onEventChange={onEventChange} />;
}
