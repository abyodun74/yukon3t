"use client";

import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { Sheet } from "@/components/sheet";
import { useOverlayHost } from "@/components/overlay-root";
import { useCommentToolsText } from "@/components/comment-tools-text";
import { createConfirmAction, deleteCommentMessage, type ConfirmAction, type ConfirmRun } from "@/lib/confirm-action";
import { useBackDismiss } from "@/lib/use-back-dismiss";

/**
 * A confirmation before a destructive action, built on the shared Sheet dialog (its fade + scale tween, no bounce,
 * its focus return and Escape). The Sheet portals it into the root overlay host on the `confirm` layer
 * (src/lib/overlay-layers.ts), above every sheet and full-screen viewer (Story, Muse, the Muse comments sheet inside
 * it), so it also works from inside a transformed panel such as the Muse comments sheet.
 *
 * Focus lands on Cancel, the safe choice. Escape, the back button, the backdrop and Cancel all cancel. While the
 * action runs both buttons are disabled (nothing can be confirmed twice or dismissed half way) and Delete says so.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  pendingLabel,
  cancelLabel,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: ReactNode;
  message: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  cancelLabel: string;
  pending: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { locale, dir } = useCommentToolsText();
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Server and hydration render nothing (no document to portal into); the client renders the portal afterwards.
  const mounted = useOverlayHost() !== null;

  useBackDismiss(open, onCancel);

  // After the Sheet's own focus handling (a child, so its effect runs first and records what to return focus to).
  useEffect(() => {
    if (open && mounted) cancelRef.current?.focus({ preventScroll: true });
  }, [open, mounted]);

  return (
    // A portal still bubbles React events through the tree it was rendered in (a post card, the Story viewer's tap
    // zones, the Muse feed): stopEventPropagation stops taps on the dialog there.
    <Sheet open={open} onClose={onCancel} title={title} lang={locale} dir={dir} layer="confirm" stopEventPropagation>
        <div>
          <p className="text-sm text-foreground-soft">{message}</p>
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              ref={cancelRef}
              type="button"
              disabled={pending}
              onClick={onCancel}
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              disabled={pending}
              aria-busy={pending}
              onClick={onConfirm}
              className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {pending ? pendingLabel : confirmLabel}
            </button>
          </div>
        </div>
    </Sheet>
  );
}

/**
 * createConfirmAction (src/lib/confirm-action.ts) as React state: `request(target)` opens the dialog, nothing runs
 * until `confirm()`. `run` answers false to keep the dialog open with an error (a failed delete can be retried).
 */
export function useConfirmAction<T>(run: ConfirmRun<T>): { state: ConfirmAction<T>["state"]; request: (target: T) => boolean; cancel: () => boolean; confirm: () => Promise<boolean> } {
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [flow] = useState(() => createConfirmAction<T>(rerender));
  const confirm = useCallback(() => flow.confirm((target) => runRef.current(target)), [flow]);
  return { state: flow.state, request: flow.request, cancel: flow.cancel, confirm };
}

export type ConfirmFlow<T> = ReturnType<typeof useConfirmAction<T>>;

/**
 * The delete confirmation for a comment, a reply or a Story comment: names what goes and, when known, how many replies
 * go with it ("Its 3 replies will be deleted too").
 */
export function CommentDeleteDialog<T>({
  flow,
  isReply,
  replyCount,
}: {
  flow: ConfirmFlow<T>;
  isReply: (target: T) => boolean;
  replyCount: (target: T) => number;
}) {
  const { locale, t } = useCommentToolsText();
  const { target, pending, failed } = flow.state;
  const text = t.confirmDelete;
  return (
    <ConfirmDialog
      open={target !== null}
      title={target !== null && isReply(target) ? text.replyTitle : text.commentTitle}
      message={target === null ? "" : deleteCommentMessage(text, locale, replyCount(target))}
      confirmLabel={text.delete}
      pendingLabel={text.deleting}
      cancelLabel={text.cancel}
      pending={pending}
      error={failed ? text.failed : null}
      onConfirm={() => void flow.confirm()}
      onCancel={() => flow.cancel()}
    />
  );
}
