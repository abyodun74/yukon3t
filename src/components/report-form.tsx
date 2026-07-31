"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { fileReport } from "@/app/actions/reports";
import { reportReasonCategoryValues, reportReasonCategoryLabels } from "@/lib/validations";

export type ReportTargetType = "USER" | "POST" | "MESSAGE" | "CIRCLE" | "COLLAB_POST" | "COMMENT";

/** The report dialog itself — shared by the per-post "⋯" menu and the standalone report trigger below. */
export function ReportModal({
  targetType,
  targetId,
  reportedUserId,
  onClose,
}: {
  targetType: ReportTargetType;
  targetId: string;
  reportedUserId?: string;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<(typeof reportReasonCategoryValues)[number]>("OTHER");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");
  const [isPending, startTransition] = useTransition();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-xl bg-surface p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Report {targetType === "USER" ? "this account" : targetType === "COMMENT" ? "comment" : "post"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-foreground-soft hover:text-danger">
            <X size={18} />
          </button>
        </div>

        {status === "sent" ? (
          <p className="mt-3 text-sm text-success">
            Reported. Our team reviews reports within 24 hours.
          </p>
        ) : (
          <>
            <label className="mt-3 block text-xs font-medium text-foreground-soft">Reason</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as typeof category)}
              className="mt-1 w-full rounded-md border border-line bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
            >
              {reportReasonCategoryValues.map((value) => (
                <option key={value} value={value}>
                  {reportReasonCategoryLabels[value]}
                </option>
              ))}
            </select>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="A few details (min 10 characters)"
              rows={3}
              className="mt-2 w-full rounded-md border border-line bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={isPending || reason.trim().length < 10}
                onClick={() => {
                  const fd = new FormData();
                  fd.set("targetType", targetType);
                  fd.set("targetId", targetId);
                  if (reportedUserId) fd.set("reportedUserId", reportedUserId);
                  fd.set("reasonCategory", category);
                  fd.set("reason", reason);
                  startTransition(async () => {
                    const result = await fileReport(fd);
                    setStatus(result.error ? "error" : "sent");
                  });
                }}
                className="rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                Submit report
              </button>
              <button type="button" onClick={onClose} className="text-xs text-foreground-soft">
                Cancel
              </button>
            </div>
            {status === "error" && (
              <p className="mt-2 text-xs text-danger">Couldn&apos;t submit — try again shortly.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Standalone "Report" text trigger for spots that aren't behind a "⋯" menu (a profile page, a comment). */
export function ReportTrigger({
  targetType,
  targetId,
  reportedUserId,
  label = "Report",
}: {
  targetType: ReportTargetType;
  targetId: string;
  reportedUserId?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-foreground-soft hover:text-danger"
      >
        {label}
      </button>
      {open && (
        <ReportModal
          targetType={targetType}
          targetId={targetId}
          reportedUserId={reportedUserId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
