"use client";

import { useState, useTransition } from "react";
import { fileReport } from "@/app/actions/reports";
import { hapticNotification } from "@/lib/haptics";
import { reportReasonCategoryValues } from "@/lib/validations";
import { Sheet } from "@/components/sheet";
import { useUiText } from "@/components/ui-text";

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
  const { locale, dir, t: ui } = useUiText();
  const t = ui.report;

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
      title={
        targetType === "USER" || targetType === "COMMENT" || targetType === "MESSAGE"
          ? t.titles[targetType]
          : t.titles.POST
      }
      lang={locale}
      dir={dir}
    >
      {status === "sent" ? (
        <p className="mt-3 text-sm text-success">{t.sent}</p>
      ) : (
        <>
          <label className="mt-3 block text-xs font-medium text-foreground-soft">{t.reason}</label>
          <select
            aria-label={t.reason}
            value={category}
            onChange={(e) => setCategory(e.target.value as typeof category)}
            className="mt-1 w-full rounded-md border border-line bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
          >
            {reportReasonCategoryValues.map((value) => (
              <option key={value} value={value}>
                {t.reasons[value]}
              </option>
            ))}
          </select>
          <textarea
            aria-label={t.details}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t.details}
            rows={3}
            className="mt-2 w-full rounded-md border border-line bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
          {evidenceText !== undefined && (
            <p className="mt-2 rounded-md bg-accent-soft px-2 py-1.5 text-xs text-foreground-soft">
              {t.evidence}
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
              {t.submit}
            </button>
            <button type="button" onClick={onClose} className="text-xs text-foreground-soft">
              {ui.cancel}
            </button>
          </div>
          {status === "error" && <p role="alert" className="mt-2 text-xs text-danger">{t.error}</p>}
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
  label,
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
  const reportLabel = useUiText().t.report.trigger;
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
        {label ?? reportLabel}
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
