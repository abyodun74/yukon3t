"use client";

import { useState, useTransition } from "react";
import { exportMyData, deleteMyAccount, deactivateAccount } from "@/app/actions/profile";
import { useSettingsText } from "@/components/settings-text";

export function AccountDangerZone() {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const t = useSettingsText().t.data;

  return (
    <div className="space-y-4 rounded-xl border border-danger/40 p-5">
      <div>
        <h2 className="font-semibold">{t.heading}</h2>
        <p className="mt-1 text-sm text-foreground-soft">{t.stored}</p>
        <p className="mt-2 text-sm text-foreground-soft">{t.exportIntro}</p>
        <button
          type="button"
          onClick={() =>
            startTransition(async () => {
              setExportError(null);
              const result = await exportMyData();
              if (result.error) {
                setExportError(t.exportLimited);
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
          {t.export}
        </button>
        {exportError && <p role="alert" className="mt-2 text-xs text-danger">{exportError}</p>}
      </div>

      <div className="border-t border-line pt-4">
        <h2 className="font-semibold">{t.deactivateHeading}</h2>
        <p className="mt-1 text-sm text-foreground-soft">{t.deactivateIntro}</p>
        {!confirmingDeactivate ? (
          <button
            type="button"
            onClick={() => setConfirmingDeactivate(true)}
            className="mt-3 rounded-lg border border-line px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent"
          >
            {t.deactivate}
          </button>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => startTransition(() => deactivateAccount())}
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {t.deactivateConfirm}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDeactivate(false)}
              className="text-sm text-foreground-soft"
            >
              {t.cancel}
            </button>
          </div>
        )}
      </div>

      <div className="border-t border-line pt-4">
        <h2 className="font-semibold text-danger">{t.deleteHeading}</h2>
        <p className="mt-1 text-sm text-foreground-soft">{t.deleteIntro}</p>
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="mt-3 rounded-lg border border-danger px-4 py-2 text-sm font-medium text-danger"
          >
            {t.delete}
          </button>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => startTransition(() => deleteMyAccount())}
              className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {t.deleteConfirm}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-sm text-foreground-soft"
            >
              {t.cancel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
