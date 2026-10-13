"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { blockUser, unblockUser } from "@/app/actions/blocks";
import { hapticNotification, hapticImpact } from "@/lib/haptics";
import { useUiText } from "@/components/ui-text";
import { format } from "@/lib/i18n/locales";

/** Toggles block state for a profile — always visible next to Report, unlike Report it needs no reason. */
export function BlockButton({
  targetId,
  targetName,
  initiallyBlocked,
}: {
  targetId: string;
  /** Null for an account whose name the data doesn't have: the wording then says "this account". */
  targetName: string | null;
  initiallyBlocked: boolean;
}) {
  const router = useRouter();
  const [blocked, setBlocked] = useState(initiallyBlocked);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { locale, dir, t } = useUiText();

  if (blocked) {
    return (
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await unblockUser(targetId);
            if (!result.error) {
              hapticImpact("light");
              setBlocked(false);
              router.refresh();
            }
          })
        }
        lang={locale}
        dir={dir}
        className="text-xs text-foreground-soft hover:text-accent disabled:opacity-50"
      >
        {targetName ? format(t.block.unblock, { name: targetName }) : t.block.unblockAccount}
      </button>
    );
  }

  if (confirming) {
    return (
      <span lang={locale} dir={dir} className="flex items-center gap-2 text-xs">
        <span className="text-foreground-soft">
          {targetName ? format(t.block.confirm, { name: targetName }) : t.block.confirmAccount}
        </span>
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await blockUser(targetId);
              if (!result.error) {
                hapticNotification("warning");
                setBlocked(true);
                setConfirming(false);
                router.refresh();
              }
            })
          }
          className="font-medium text-danger disabled:opacity-50"
        >
          {t.block.yes}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="text-foreground-soft">
          {t.cancel}
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      lang={locale}
      dir={dir}
      className="text-xs text-foreground-soft hover:text-danger"
    >
      {t.block.block}
    </button>
  );
}
