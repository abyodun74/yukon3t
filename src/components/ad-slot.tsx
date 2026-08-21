import { getActiveAdForDisplay, recordAdImpression } from "@/app/actions/ads";
import { AdClickTracker } from "@/components/ad-click-tracker";

/**
 * Renders nothing when no campaign is currently ACTIVE and within its date
 * window — a missing ad slot, not an empty placeholder box. Impression
 * counting is a naive "rendered = seen" per page load (not deduped per
 * viewer), a reasonable v1 given there's no ad-serving infra to dedupe
 * against yet.
 */
export async function AdSlot() {
  const ad = await getActiveAdForDisplay();
  if (!ad) return null;

  await recordAdImpression(ad.id);

  return (
    <div className="rounded-xl border border-line p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-soft">Sponsored</p>
      <AdClickTracker id={ad.id} href={ad.linkUrl}>
        <div className="mt-2 flex gap-3">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-black">
            {ad.mediaType === "IMAGE" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ad.mediaUrl} alt="" className="h-full w-full object-cover" />
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
