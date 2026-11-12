import { getActiveAdForDisplay } from "@/app/actions/ads";
import { AdClickTracker } from "@/components/ad-click-tracker";
import { getDictionary } from "@/lib/i18n/server";
import { recordAdImpressionFor } from "@/lib/ad-counters";
import { getClientIp } from "@/lib/client-ip";

/**
 * Renders nothing when no campaign is currently ACTIVE and within its date
 * window — a missing ad slot, not an empty placeholder box. An impression is
 * "rendered = seen", counted on the server only, at most once per viewer IP
 * per campaign per 30 minutes (src/lib/ad-counters.ts), so reloading the
 * page doesn't inflate it.
 */
export async function AdSlot() {
  const ad = await getActiveAdForDisplay();
  if (!ad) return null;

  await recordAdImpressionFor(ad.id, await getClientIp());
  const sponsored = (await getDictionary()).feed.sponsored;

  return (
    <div className="rounded-xl border border-line p-4">
      <p className="text-[0.625rem] font-semibold uppercase tracking-wide text-foreground-soft rtl:tracking-normal">
        {sponsored}
      </p>
      <AdClickTracker id={ad.id} href={ad.linkUrl}>
        <div className="mt-2 flex gap-3">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-black">
            {ad.mediaType === "IMAGE" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ad.mediaUrl} alt={ad.companyName} loading="lazy" decoding="async" className="h-full w-full object-cover" />
            ) : (
              <video src={ad.mediaUrl} className="h-full w-full object-cover" muted autoPlay loop playsInline />
            )}
          </div>
          <div className="min-w-0">
            <p className="break-words font-semibold">{ad.companyName}</p>
            <p className="break-words text-sm">{ad.headline}</p>
            <p className="mt-1 line-clamp-2 text-xs text-foreground-soft">{ad.body}</p>
          </div>
        </div>
      </AdClickTracker>
    </div>
  );
}
