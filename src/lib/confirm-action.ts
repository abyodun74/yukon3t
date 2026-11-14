import { plural, type Locale } from "@/lib/i18n/locales";

// "Are you sure?" for a destructive action (deleting a comment or reply): the pure state machine behind useConfirmAction
// (src/components/confirm-dialog.tsx). Nothing runs on the first tap: `request` only remembers what is to be deleted
// and the dialog opens; `confirm` runs the action once, and every other confirm while it is in flight is dropped, so
// a double tap on "Delete" never deletes (or counts off) twice. `cancel` forgets the target and runs nothing; it is
// ignored while the action is in flight (the dialog can't be dismissed half way through a delete).
//
// The action answers false when it failed and should stay on screen (the dialog keeps its target and shows `failed`,
// so the person can try again or cancel); anything else (or throwing, which counts as failed) is done with.

export type ConfirmActionState<T> = {
  /** What the open dialog is about; null when it is closed. */
  target: T | null;
  /** True while the action runs. */
  pending: boolean;
  /** True when the last attempt failed (cleared by the next request, confirm or cancel). */
  failed: boolean;
};

export type ConfirmAction<T> = {
  readonly state: ConfirmActionState<T>;
  /** Opens the dialog for `target`. Ignored while an action is in flight. */
  request(target: T): boolean;
  /** Closes the dialog without running anything. Ignored while an action is in flight. */
  cancel(): boolean;
  /** Runs `run` for the current target, at most once at a time. Resolves true when it ran and succeeded. */
  confirm(run: ConfirmRun<T>): Promise<boolean>;
};

export type ConfirmRun<T> = (target: T) => Promise<boolean | void> | boolean | void;

export function createConfirmAction<T>(onChange?: () => void): ConfirmAction<T> {
  let state: ConfirmActionState<T> = { target: null, pending: false, failed: false };
  const set = (next: ConfirmActionState<T>) => {
    state = next;
    onChange?.();
  };
  return {
    get state() {
      return state;
    },
    request(target) {
      if (state.pending) return false;
      set({ target, pending: false, failed: false });
      return true;
    },
    cancel() {
      if (state.pending) return false;
      if (state.target !== null || state.failed) set({ target: null, pending: false, failed: false });
      return true;
    },
    async confirm(run) {
      const target = state.target;
      if (target === null || state.pending) return false;
      set({ target, pending: true, failed: false });
      let ok = false;
      try {
        ok = (await run(target)) !== false;
      } catch {
        ok = false;
      }
      set(ok ? { target: null, pending: false, failed: false } : { target, pending: false, failed: true });
      return ok;
    },
  };
}

/**
 * What a comment's delete confirmation says: how many replies go with it when a top-level comment takes replies with
 * it ("Its 3 replies will be deleted too"), the plain warning otherwise.
 */
export function deleteCommentMessage(
  text: { body: string; bodyWithReplies: string },
  locale: Locale,
  replyCount: number,
): string {
  return replyCount > 0 ? plural(locale, text.bodyWithReplies, replyCount) : text.body;
}

/** Every reply under a comment, at any depth (a post comment's delete cascades through the whole chain). */
export function countDescendants(node: { replies?: readonly { replies?: readonly unknown[] }[] }): number {
  const replies = (node.replies ?? []) as { replies?: readonly { replies?: readonly unknown[] }[] }[];
  return replies.reduce((sum, reply) => sum + 1 + countDescendants(reply), 0);
}
