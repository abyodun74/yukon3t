"use client";

import { useState, useTransition } from "react";
import { deleteCircle } from "@/app/actions/circles";
import { useCirclesText } from "@/components/circles-text";
import { plural } from "@/lib/i18n/locales";

export function DeleteCircleButton({
  circleId,
  isAdminOverride = false,
  subCircleCount = 0,
}: {
  circleId: string;
  isAdminOverride?: boolean;
  /** Deleting a main Circle also deletes its sub-circles (Circle.parent onDelete: Cascade) — say so before it happens. */
  subCircleCount?: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { locale, t: circles } = useCirclesText();
  const t = circles.delete;

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-danger hover:border-danger"
      >
        {isAdminOverride ? t.openAdmin : t.open}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-foreground-soft">
        {isAdminOverride ? t.confirmAdmin : t.confirm}
        {subCircleCount > 0 && (
          <strong className="font-semibold text-danger"> {plural(locale, t.subCircles, subCircleCount)}</strong>
        )}
      </span>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await deleteCircle(circleId);
          })
        }
        className="rounded-md bg-danger px-2.5 py-1 font-medium text-white disabled:opacity-50"
      >
        {t.action}
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() => setConfirming(false)}
        className="rounded-md border border-line px-2.5 py-1 disabled:opacity-50"
      >
        {t.cancel}
      </button>
    </div>
  );
}
