"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveReport } from "@/app/actions/reports";

const CONTENT_LABELS: Record<string, string> = {
  POST: "Remove the post",
  COMMENT: "Remove the comment",
  MESSAGE: "Remove the message",
  CIRCLE: "Delete the Circle",
  COLLAB_POST: "Close the collab post",
};

// Ban/suspend act on the *user*, not just the reported content, and can't be
// undone by the reporter or the target — same irreversible-impact tier as
// account deletion (see account-danger-zone.tsx) or the admin user-delete
// button, both of which already require a second confirming step. This form
// used to let either fire from a single dropdown-select-then-tap, with a
// mis-tap between adjacent <option>s as the only thing standing in the way.
const ACTIONS_REQUIRING_CONFIRMATION = new Set(["SUSPEND", "BAN"]);

export function ModerationActionForm({
  reportId,
  targetType,
}: {
  reportId: string;
  targetType: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [action, setAction] = useState("REPORT_DISMISSED");
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const contentLabel = CONTENT_LABELS[targetType];
  const needsConfirmation = ACTIONS_REQUIRING_CONFIRMATION.has(action);

  function submit() {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    fd.set("reportId", reportId);
    startTransition(async () => {
      await resolveReport(fd);
      router.refresh();
    });
  }

  return (
    <form
      ref={formRef}
      className="mt-3 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (needsConfirmation && !confirming) {
          setConfirming(true);
          return;
        }
        submit();
      }}
    >
      <select
        name="action"
        required
        value={action}
        onChange={(e) => {
          setAction(e.target.value);
          setConfirming(false);
        }}
        className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs"
      >
        <option value="REPORT_DISMISSED">Dismiss (no violation)</option>
        {contentLabel && <option value="REMOVE_CONTENT">{contentLabel}</option>}
        <option value="WARN">Warn user</option>
        <option value="SUSPEND">Suspend user (temporary)</option>
        <option value="BAN">Ban user (permanent)</option>
        <option value="REPORT_RESOLVED">Mark resolved</option>
      </select>
      <input
        name="note"
        required
        minLength={5}
        placeholder="Reason (shown to the user)"
        className="min-w-[16rem] flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-xs"
      />
      {needsConfirmation && confirming ? (
        <span className="flex items-center gap-2">
          <span className="text-xs font-medium text-danger">
            {action === "BAN" ? "Permanently ban this user?" : "Suspend this user?"}
          </span>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {isPending ? "Applying..." : `Yes, ${action === "BAN" ? "ban" : "suspend"}`}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="text-xs text-foreground-soft"
          >
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50"
        >
          {isPending ? "Applying..." : "Apply"}
        </button>
      )}
    </form>
  );
}
