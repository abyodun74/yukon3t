"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveReport } from "@/app/actions/reports";

const CONTENT_LABELS: Record<string, string> = {
  POST: "Remove the post",
  COMMENT: "Remove the comment",
  MESSAGE: "Remove the message",
  CIRCLE: "Delete the Circle",
  COLLAB_POST: "Close the collab post",
};

export function ModerationActionForm({
  reportId,
  targetType,
}: {
  reportId: string;
  targetType: string;
}) {
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const contentLabel = CONTENT_LABELS[targetType];

  return (
    <form
      ref={formRef}
      className="mt-3 flex flex-wrap items-center gap-2"
      action={(fd) => {
        fd.set("reportId", reportId);
        startTransition(async () => {
          await resolveReport(fd);
          router.refresh();
        });
      }}
    >
      <select
        name="action"
        required
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
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50"
      >
        Apply
      </button>
    </form>
  );
}
