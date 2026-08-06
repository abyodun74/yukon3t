"use client";

import { useState, useTransition } from "react";
import { adminDeleteUser } from "@/app/actions/password-auth";

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "Reason must be at least 5 characters.",
  not_found: "Account no longer exists.",
  cannot_delete_self: "You can't delete your own account this way.",
  cannot_delete_admin: "Can't delete another admin account.",
  confirmation_mismatch: "Typed handle didn't match — nothing was deleted.",
};

/** Irreversible — permanently deletes the account and everything it owns. */
export function AdminDeleteUserButton({ userId, handle }: { userId: string; handle: string }) {
  const [isPending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [confirmHandle, setConfirmHandle] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  if (deleted) {
    return <p className="text-xs text-foreground-soft">Account deleted.</p>;
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="rounded-lg border border-danger px-3 py-1.5 text-xs font-medium text-danger"
      >
        Delete account
      </button>
    );
  }

  return (
    <div className="w-full max-w-xs space-y-2 rounded-lg border border-danger/40 p-3">
      <p className="text-xs text-danger">
        Permanently deletes this account and everything it owns. Cannot be undone. Type{" "}
        <span className="font-mono">{handle}</span> to confirm.
      </p>
      <input
        type="text"
        value={confirmHandle}
        onChange={(e) => setConfirmHandle(e.target.value)}
        placeholder={handle}
        className="w-full rounded-lg border border-line bg-background px-3 py-1.5 text-xs outline-none focus:border-accent"
      />
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (min 5 characters)"
        rows={2}
        className="w-full rounded-lg border border-line bg-background px-3 py-1.5 text-xs outline-none focus:border-accent"
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={isPending || confirmHandle !== handle || reason.trim().length < 5}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const fd = new FormData();
              fd.set("userId", userId);
              fd.set("confirmHandle", confirmHandle);
              fd.set("reason", reason);
              const result = await adminDeleteUser(fd);
              if (result.error) {
                setError(ERROR_MESSAGES[result.error] ?? "Something went wrong.");
              } else {
                setDeleted(true);
              }
            })
          }
          className="rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          Yes, permanently delete
        </button>
        <button
          type="button"
          onClick={() => {
            setExpanded(false);
            setConfirmHandle("");
            setReason("");
            setError(null);
          }}
          className="text-xs text-foreground-soft"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
