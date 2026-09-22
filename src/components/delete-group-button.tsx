"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteGroupChat } from "@/app/actions/messages";

/**
 * Creator or site admin: deletes the whole group, for every member —
 * distinct from LeaveGroupButton, which only removes the caller (and
 * reassigns ownership rather than deleting, unless they're the last one
 * left). Tap-to-confirm inline rather than a browser confirm() dialog,
 * matching this app's other destructive-action patterns (e.g. StoryViewer's
 * own delete confirm). `isAdminOverride` is the same flag delete-circle-
 * button.tsx uses: same action either way (deleteGroupChat now allows an
 * admin regardless of who created the group), just clearer copy so an
 * admin acting on someone else's group from /admin/groups knows what
 * they're about to do.
 */
export function DeleteGroupButton({
  conversationId,
  isAdminOverride = false,
}: {
  conversationId: string;
  isAdminOverride?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-danger/40 bg-danger/5 px-2 py-1.5 text-xs">
        <span className="text-danger">
          {isAdminOverride ? "Delete this group for everyone? (admin)" : "Delete for everyone?"}
        </span>
        <button
          type="button"
          disabled={isPending}
          onClick={() => setConfirming(false)}
          className="rounded px-1.5 py-0.5 font-medium hover:bg-line disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await deleteGroupChat(conversationId);
            })
          }
          className="rounded bg-danger px-1.5 py-0.5 font-medium text-white transition-transform active:scale-95 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-danger transition-transform hover:border-danger active:scale-95"
    >
      <Trash2 size={13} />
      {isAdminOverride ? "Delete group (admin)" : "Delete group"}
    </button>
  );
}
