"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Flag, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { deletePost } from "@/app/actions/posts";
import { ReportModal } from "@/components/report-form";

/** The "⋯" menu on each post: Edit/Delete (own post; admin gets Delete only) and Report (relocated here from the old always-visible inline form). */
export function PostOptionsMenu({
  postId,
  canEdit,
  canDelete,
  canReport,
  reportTargetId,
  reportedUserId,
  onEdit,
}: {
  postId: string;
  canEdit: boolean;
  canDelete: boolean;
  canReport: boolean;
  reportTargetId: string;
  reportedUserId: string;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmingDelete(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  if (!canEdit && !canDelete && !canReport) return null;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Post options"
        className="rounded-lg p-1 text-foreground-soft hover:bg-line"
      >
        <MoreHorizontal size={16} />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-line"
            >
              <Pencil size={14} /> Edit
            </button>
          )}
          {canReport && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setReporting(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-line"
            >
              <Flag size={14} /> Report
            </button>
          )}
          {canDelete && !confirmingDelete && (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger hover:bg-line"
            >
              <Trash2 size={14} /> Delete
            </button>
          )}
          {canDelete && confirmingDelete && (
            <div className="px-3 py-2 text-xs">
              <p className="text-foreground-soft">Delete this post? This can&apos;t be undone.</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    startTransition(async () => {
                      const result = await deletePost(postId);
                      if (!result.error) {
                        setOpen(false);
                        router.refresh();
                      }
                    });
                  }}
                  className="rounded-md bg-danger px-2 py-1 font-medium text-white disabled:opacity-50"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="text-foreground-soft"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {reporting && (
        <ReportModal
          targetType="POST"
          targetId={reportTargetId}
          reportedUserId={reportedUserId}
          onClose={() => setReporting(false)}
        />
      )}
    </div>
  );
}
