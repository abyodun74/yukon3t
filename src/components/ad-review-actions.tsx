"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveAdCampaign, rejectAdCampaign, pauseAdCampaign } from "@/app/actions/ads";

export function AdReviewActions({ id, status }: { id: string; status: string }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (status === "PENDING_REVIEW") {
    if (rejecting) {
      return (
        <div className="mt-2 space-y-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="Why is this being rejected? (the advertiser isn't shown this directly, but keep a record)"
            className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => setRejecting(false)}
              className="rounded-md border border-line px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isPending || !reason.trim()}
              onClick={() =>
                startTransition(async () => {
                  const fd = new FormData();
                  fd.set("reason", reason.trim());
                  await rejectAdCampaign(id, fd);
                  router.refresh();
                })
              }
              className="rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              Reject & refund
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await approveAdCampaign(id);
              router.refresh();
            })
          }
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink disabled:opacity-50"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => setRejecting(true)}
          className="rounded-md border border-line px-3 py-1.5 text-xs text-danger hover:border-danger disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    );
  }

  if (status === "ACTIVE") {
    return (
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await pauseAdCampaign(id);
            router.refresh();
          })
        }
        className="mt-2 rounded-md border border-line px-3 py-1.5 text-xs text-danger hover:border-danger disabled:opacity-50"
      >
        Pause
      </button>
    );
  }

  return null;
}
