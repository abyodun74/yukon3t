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
import { getDictionary } from "@/lib/i18n/server";

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
  const dictionary = await getDictionary();
  const t = dictionary.settings.ambient;

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
        <BackButton href="/settings" label={dictionary.shell.common.back} />
        <h1 className="font-display text-2xl font-semibold">{t.heading}</h1>
        <p className="mt-2 text-sm text-foreground-soft">{t.page.intro}</p>
      </div>

      <section>
        <h2 className="text-sm font-semibold">{t.page.circleHeading}</h2>
        <p className="mt-1 text-xs text-foreground-soft">{t.page.circleIntro}</p>
        <div className="mt-3">
          <InnerCircleManager
            initialMembers={members}
            initialCandidates={candidates}
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold">{t.page.momentHeading}</h2>
        <p className="mt-1 text-xs text-foreground-soft">{t.page.momentIntro}</p>
        <div className="mt-3">
          <AmbientMomentComposer initialMoments={myMoments} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold">{t.page.feedHeading}</h2>
        <p className="mt-1 text-xs text-foreground-soft">{t.page.feedIntro}</p>
        <div className="mt-3">
          <AmbientFeedPreview moments={feed} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold">{t.page.widgetHeading}</h2>
        <div className="mt-3">
          <AmbientWidgetTokenPanel initialStatus={tokenStatus} />
        </div>
      </section>
    </div>
  );
}
