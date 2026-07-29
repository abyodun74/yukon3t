"use client";

import { useState, useTransition } from "react";
import { fileReport } from "@/app/actions/reports";

export function ReportButton({
  targetType,
  targetId,
  reportedUserId,
}: {
  targetType: "USER" | "POST" | "MESSAGE" | "CIRCLE" | "COLLAB_POST";
  targetId: string;
  reportedUserId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-foreground-soft hover:text-danger"
      >
        Report
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-line bg-surface p-3">
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="What's wrong with this? (min 10 characters)"
        rows={2}
        className="w-full rounded-md border border-line bg-background px-2 py-1.5 text-xs outline-none focus:border-accent"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={isPending || reason.trim().length < 10}
          onClick={() => {
            const fd = new FormData();
            fd.set("targetType", targetType);
            fd.set("targetId", targetId);
            if (reportedUserId) fd.set("reportedUserId", reportedUserId);
            fd.set("reason", reason);
            startTransition(async () => {
              const result = await fileReport(fd);
              setStatus(result.error ? "error" : "sent");
            });
          }}
          className="rounded-md bg-danger px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          Submit report
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-foreground-soft"
        >
          Cancel
        </button>
      </div>
      {status === "sent" && (
        <p className="mt-1 text-xs text-success">
          Reported. Our team reviews reports within 24 hours.
        </p>
      )}
      {status === "error" && (
        <p className="mt-1 text-xs text-danger">
          Couldn&apos;t submit — try again shortly.
        </p>
      )}
    </div>
  );
}
