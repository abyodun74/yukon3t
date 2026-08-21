import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { getAdCampaigns } from "@/app/actions/ads";
import { AdReviewActions } from "@/components/ad-review-actions";
import { formatCents } from "@/lib/ads";

const STATUS_LABELS: Record<string, string> = {
  PENDING_REVIEW: "Needs review",
  ACTIVE: "Live",
  PENDING_PAYMENT: "Awaiting payment",
  REJECTED: "Rejected",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  DRAFT: "Draft",
};

const SECTION_ORDER = ["PENDING_REVIEW", "ACTIVE", "PENDING_PAYMENT", "PAUSED", "REJECTED", "COMPLETED", "DRAFT"];

export default async function AdminAdsPage() {
  const user = await getSessionUserOrRedirect();
  if (!user.isAdmin) redirect("/discover");

  const campaigns = await getAdCampaigns();
  const bySection = new Map<string, typeof campaigns>();
  for (const status of SECTION_ORDER) bySection.set(status, []);
  for (const c of campaigns) bySection.get(c.status)?.push(c);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/admin/moderation" className="text-xs text-foreground-soft hover:text-accent">
        &larr; Moderation queue
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Ad campaigns</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        Paid bookings from /advertise. Approving starts the campaign immediately; rejecting
        refunds the advertiser automatically.
      </p>

      {SECTION_ORDER.map((status) => {
        const rows = bySection.get(status) ?? [];
        if (rows.length === 0) return null;
        return (
          <div key={status} className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
              {STATUS_LABELS[status]} ({rows.length})
            </h2>
            <div className="mt-3 space-y-3">
              {rows.map((c) => (
                <div key={c.id} className="rounded-xl border border-line p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex gap-3">
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-black">
                        {c.mediaType === "IMAGE" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.mediaUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <video src={c.mediaUrl} className="h-full w-full object-cover" muted />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="break-words font-semibold">{c.companyName}</p>
                        <p className="break-words text-sm">{c.headline}</p>
                        <p className="mt-1 line-clamp-2 text-xs text-foreground-soft">{c.body}</p>
                        <p className="mt-1 text-xs text-foreground-soft">
                          {c.contactName} &middot; {c.contactEmail}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-xs text-foreground-soft">
                      <p className="font-medium text-foreground">{formatCents(c.priceCents, c.currency)}</p>
                      <p>{c.durationDays} days</p>
                      {c.status === "ACTIVE" && c.endAt && (
                        <p>ends {c.endAt.toLocaleDateString()}</p>
                      )}
                      <p>
                        {c.impressionCount} views &middot; {c.clickCount} clicks
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-foreground-soft">
                    <a href={c.linkUrl} target="_blank" rel="noopener noreferrer" className="hover:text-accent">
                      {c.linkUrl}
                    </a>
                  </p>
                  {c.rejectionReason && (
                    <p className="mt-2 text-xs text-danger">Rejected: {c.rejectionReason}</p>
                  )}
                  <AdReviewActions id={c.id} status={c.status} />
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {campaigns.length === 0 && (
        <p className="mt-8 text-sm text-foreground-soft">No ad campaigns yet.</p>
      )}
    </div>
  );
}
