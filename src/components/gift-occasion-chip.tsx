"use client";

import { useEffect, useState } from "react";
import { Gift, X } from "lucide-react";
import { GiftPickerSheet } from "@/components/gift-picker-sheet";
import { useGiftsText } from "@/components/gifts-text";
import { getGiftOccasionChip } from "@/app/actions/gifts";
import type { OccasionKind } from "@/lib/gift-occasions";

// A small, dismissible gift suggestion above a 1:1 chat's composer (Phase A), shown only on an occasion day for the
// other person (getGiftOccasionChip decides on the server, with every send rule). It says why in one short line ("It's
// their birthday today") and opens the gift picker; it never notifies anyone. Dismissing it hides it for that occasion
// for the rest of the viewer's own day, remembered in this browser only (localStorage, which may be unavailable: then
// it just shows again next time). The key uses the viewer's own local date, never anything about the other person's.

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

export function giftChipDismissKey(recipientId: string, kind: string, day: string): string {
  return `yk-gift-chip:${recipientId}:${kind}:${day}`;
}

function isDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function rememberDismissed(key: string) {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // Storage unavailable (private mode, blocked): the chip simply comes back next time.
  }
}

export function GiftOccasionChip({
  recipientId,
  recipientName,
  conversationId,
}: {
  recipientId: string;
  recipientName: string | null;
  conversationId: string;
}) {
  const { locale, dir, t } = useGiftsText();
  const [kind, setKind] = useState<OccasionKind | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getGiftOccasionChip(recipientId, conversationId)
      .then((result) => {
        if (cancelled || result.error || !result.occasion) return;
        if (isDismissed(giftChipDismissKey(recipientId, result.occasion.kind, todayKey()))) return;
        setKind(result.occasion.kind);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [recipientId, conversationId]);

  if (!kind) return null;

  return (
    <div
      lang={locale}
      dir={dir}
      role="region"
      aria-label={t.occasions.chipLabel}
      className="mb-2 flex items-center gap-2 rounded-full border border-accent/40 bg-accent-soft/50 py-1 ps-3 pe-1 text-xs"
    >
      <Gift size={14} aria-hidden className="shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate">{t.occasions.reasons[kind]}</span>
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="shrink-0 rounded-full bg-accent px-3 py-1 font-semibold text-accent-ink"
      >
        {t.occasions.chipSend}
      </button>
      <button
        type="button"
        onClick={() => {
          rememberDismissed(giftChipDismissKey(recipientId, kind, todayKey()));
          setKind(null);
        }}
        aria-label={t.occasions.chipDismiss}
        title={t.occasions.chipDismiss}
        className="shrink-0 rounded-full p-1.5 text-foreground-soft hover:bg-line"
      >
        <X size={14} aria-hidden />
      </button>
      <GiftPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        recipientId={recipientId}
        recipientName={recipientName}
        place={{ context: "CHAT", conversationId }}
      />
    </div>
  );
}
