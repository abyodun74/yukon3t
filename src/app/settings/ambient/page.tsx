import type { Metadata } from "next";
import { BackButton } from "@/components/back-button";
import { getSessionUserOrRedirect } from "@/lib/page-guards";
import {
  getInnerCircle,
  getInnerCircleCandidates,
  getAmbientFeed,
  getMyAmbientMoments,
  getAmbientWidgetTokenStatus,
} from "@/app/actions/ambient";
import { InnerCircleManager } from "@/components/inner-circle-manager";
import { AmbientMomentComposer } from "@/components/ambient-moment-composer";
import { AmbientWidgetTokenPanel } from "@/components/ambient-widget-token-panel";
import { AmbientFeedPreview } from "@/components/ambient-feed-preview";

const title = "Ambient | YuKon3t";

export const metadata: Metadata = {
  title: { absolute: title },
  description: "Manage your Inner Circle and ambient moments.",
};

/**
 * Groundwork for "ambient presence" (see InnerCircleMember/AmbientMoment/
 * AmbientWidgetToken's schema doc comments) — there is no lock-screen
 * widget, Android widget, or watch app yet; this page is where that would
 * eventually be configured from, and in the meantime lets you try the
 * underlying idea (a small curated group, casual photos, a feed preview)
 * entirely inside the app.
 */
export default async function AmbientSettingsPage() {
  await getSessionUserOrRedirect();

  const [members, candidates, feed, myMoments, tokenStatus] = await Promise.all([
    getInnerCircle(),
    getInnerCircleCandidates(),
    getAmbientFeed(),
    getMyAmbientMoments(),
    getAmbientWidgetTokenStatus(),
  ]);

  return (
    <div className="mx-auto max-w-xl space-y-10 px-4 py-10">
      <div>
        <BackButton href="/settings" />
        <h1 className="font-display text-2xl font-semibold">Ambient</h1>
        <p className="mt-2 text-sm text-foreground-soft">
          Ambient presence over performed posting — a handful of people you actually know, and
          casual moments instead of composed posts. There&apos;s no lock-screen widget, home-screen
          widget, or watch app for this yet (that needs real native development this page can&apos;t
          do on its own), but everything below works right now, inside the app, as the groundwork
          for one.
        </p>
      </div>

      <section>
        <h2 className="text-sm font-semibold">Your Inner Circle</h2>
        <p className="mt-1 text-xs text-foreground-soft">
          Whoever&apos;s here is who your ambient feed (and a future widget) would show — not the
          same as who you subscribe to or follow.
        </p>
        <div className="mt-3">
          <InnerCircleManager
            initialMembers={members}
            initialCandidates={candidates}
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold">Share a moment</h2>
        <p className="mt-1 text-xs text-foreground-soft">
          One photo, an optional caption — visible only to people who have you in their Inner
          Circle, gone after 48 hours.
        </p>
        <div className="mt-3">
          <AmbientMomentComposer initialMoments={myMoments} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold">Your ambient feed (preview)</h2>
        <p className="mt-1 text-xs text-foreground-soft">
          What you&apos;d see ambiently from your Inner Circle — this is the same data
          /api/ambient/feed returns for a future widget, shown here since no widget exists yet.
        </p>
        <div className="mt-3">
          <AmbientFeedPreview moments={feed} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold">For a future widget</h2>
        <div className="mt-3">
          <AmbientWidgetTokenPanel initialStatus={tokenStatus} />
        </div>
      </section>
    </div>
  );
}
