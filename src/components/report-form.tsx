"use client";

import { useState, useTransition } from "react";
import { fileReport } from "@/app/actions/reports";
import { hapticNotification } from "@/lib/haptics";
import { reportReasonCategoryValues, reportReasonCategoryLabels } from "@/lib/validations";
import { Sheet } from "@/components/sheet";

export type ReportTargetType = "USER" | "POST" | "MESSAGE" | "CIRCLE" | "COLLAB_POST" | "COMMENT";

/**
 * The report dialog itself — shared by the per-post "⋯" menu and the
 * standalone report trigger below. Migrated onto the shared Sheet
 * component (see that file): every call site now renders this
 * unconditionally once `open` has ever been true rather than
 * conditionally mounting/unmounting it (Sheet's AnimatePresence needs it
 * mounted through its own exit animation), so the reset-on-close effect
 * below is what gives a reopened dialog its fresh-form behavior back —
 * previously automatic, since each open used to be a brand new mount.
 */
export function ReportModal({
  targetType,
  targetId,
  reportedUserId,
  evidenceText,
  open,
  onClose,
}: {
  targetType: ReportTargetType;
  targetId: string;
  reportedUserId?: string;
  /** For a message from a secret (end-to-end encrypted) chat: its decrypted text, which the server can't read. Shared with moderators only when the reporter submits. */
  evidenceText?: string;
  open: boolean;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<(typeof reportReasonCategoryValues)[number]>("OTHER");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");
  const [isPending, startTransition] = useTransition();

  // Resets the form at the start of each new open, so a reopen starts
  // fresh (previously automatic, since each open used to be a brand new
  // mount — see this component's own doc comment). On reopen, not on
  // close — resetting on close would blank the form's visible content
  // (or the "Reported" thank-you message) while Sheet's exit animation is
  // still fading the dialog out. Adjusted during render (React's
  // documented pattern for this) rather than a useEffect, which this
  // project's lint config flags for a synchronous setState call.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setCategory("OTHER");
      setReason("");
      setStatus("idle");
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Report ${targetType === "USER" ? "this account" : targetType === "COMMENT" ? "comment" : targetType === "MESSAGE" ? "this message" : "post"}`}
    >
      {status === "sent" ? (
        <p className="mt-3 text-sm text-success">Reported. Our team reviews reports within 24 hours.</p>
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
          {evidenceText !== undefined && (
            <p className="mt-2 rounded-md bg-accent-soft px-2 py-1.5 text-xs text-foreground-soft">
              This message is from a secret chat, so we can&apos;t read it. Submitting this report shares its text with
              our moderators so they can review it.
            </p>
          )}
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
                if (evidenceText !== undefined) fd.set("evidenceText", evidenceText);
                startTransition(async () => {
                  const result = await fileReport(fd);
                  hapticNotification(result.error ? "error" : "success");
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
          {status === "error" && <p className="mt-2 text-xs text-danger">Couldn&apos;t submit — try again shortly.</p>}
        </>
      )}
    </Sheet>
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
  // Sticky "has this ever been opened" flag — see post-card.tsx's
  // likersEverOpenedRef for why this needs to gate the mount instead of
  // `open` itself once Sheet owns the exit animation.
  const [everOpened, setEverOpened] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setEverOpened(true);
        }}
        className="text-xs text-foreground-soft hover:text-danger"
      >
        {label}
      </button>
      {everOpened && (
        <ReportModal
          targetType={targetType}
          targetId={targetId}
          reportedUserId={reportedUserId}
          open={open}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
