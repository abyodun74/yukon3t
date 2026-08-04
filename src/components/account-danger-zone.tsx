"use client";

import { useState, useTransition } from "react";
import { exportMyData, deleteMyAccount, deactivateAccount } from "@/app/actions/profile";

export function AccountDangerZone() {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  return (
    <div className="space-y-4 rounded-xl border border-danger/40 p-5">
      <div>
        <h2 className="font-semibold">Your data</h2>
        <p className="mt-1 text-sm text-foreground-soft">
          Export everything we have on you as JSON, any time, for free.
        </p>
        <button
          type="button"
          onClick={() =>
            startTransition(async () => {
              setExportError(null);
              const result = await exportMyData();
              if (result.error) {
                setExportError("Too many exports recently — try again in a bit.");
                return;
              }
              const blob = new Blob([result.data], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "yukon3t-my-data.json";
              a.click();
              URL.revokeObjectURL(url);
            })
          }
          disabled={isPending}
          className="mt-3 rounded-lg border border-line px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
        >
          Export my data
        </button>
        {exportError && <p className="mt-2 text-xs text-danger">{exportError}</p>}
      </div>

      <div className="border-t border-line pt-4">
        <h2 className="font-semibold">Deactivate account</h2>
        <p className="mt-1 text-sm text-foreground-soft">
          Temporarily hides your profile and posts. Nothing is deleted — sign
          back in any time with your password or email link to reactivate.
        </p>
        {!confirmingDeactivate ? (
          <button
            type="button"
            onClick={() => setConfirmingDeactivate(true)}
            className="mt-3 rounded-lg border border-line px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent"
          >
            Deactivate my account
          </button>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => startTransition(() => deactivateAccount())}
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
            >
              Yes, deactivate
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDeactivate(false)}
              className="text-sm text-foreground-soft"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="border-t border-line pt-4">
        <h2 className="font-semibold text-danger">Delete account</h2>
        <p className="mt-1 text-sm text-foreground-soft">
          Permanently deletes your profile, posts, messages, and Circles you
          own. This cannot be undone, and we never charge or gate this.
        </p>
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="mt-3 rounded-lg border border-danger px-4 py-2 text-sm font-medium text-danger"
          >
            Delete my account
          </button>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => startTransition(() => deleteMyAccount())}
              className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Yes, permanently delete
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-sm text-foreground-soft"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
