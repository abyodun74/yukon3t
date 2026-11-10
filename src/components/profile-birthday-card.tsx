"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Cake, Check } from "lucide-react";
import { useUiText } from "@/components/ui-text";
import { BirthdayWishSheet } from "@/components/birthday-wish-sheet";
import type { ProfileBirthdayCard as Card } from "@/lib/birthdays";
import { format } from "@/lib/i18n/locales";

/**
 * YuKon3t's birthday card at the top of a profile, on that person's birthday (all day in their own time zone; decided
 * on the server by loadProfileBirthdayCard). The owner sees "Happy birthday from YuKon3t" and a link to the setting;
 * a visitor in the chosen audience sees whose birthday it is and, when their own reminder allows it, "Send a wish",
 * which opens the same quick-wish sheet as /birthdays. Still, with no animation or confetti, so there is nothing to
 * turn off for reduced motion. Says "today" only: never a date, a year or an age.
 */
export function ProfileBirthdayCard({ card, person }: { card: Card; person: { id: string; name: string | null } }) {
  const { t: ui, dir, locale } = useUiText();
  const t = ui.birthdays;
  const headingId = useId();
  const [wished, setWished] = useState(card.kind === "visitor" && card.wish === "wished");
  const [sheetOpen, setSheetOpen] = useState(false);
  const name = person.name ?? ui.unknownName;

  return (
    <div
      role="region"
      aria-labelledby={headingId}
      lang={locale}
      dir={dir}
      className="mb-6 flex items-start gap-3 rounded-xl border border-accent/30 bg-accent/5 p-4"
    >
      <Cake size={28} aria-hidden className="mt-0.5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        {card.kind === "own" ? (
          <>
            <h2 id={headingId} className="font-semibold">
              {t.profileCard.ownTitle}
            </h2>
            <p className="mt-1 text-sm text-foreground-soft">{t.profileCard.ownBody}</p>
            <Link href="/settings#birthdays" className="mt-2 inline-block text-sm text-accent hover:underline">
              {t.profileCard.ownSettings}
            </Link>
          </>
        ) : (
          <>
            <h2 id={headingId} dir="auto" className="break-words font-semibold">
              {format(t.profileCard.visitorTitle, { name })}
            </h2>
            <p dir="auto" className="mt-1 text-sm text-foreground-soft">
              {format(t.profileCard.visitorBody, { name })}
            </p>
            {wished ? (
              <p className="mt-2 flex items-center gap-1 text-sm text-success">
                <Check size={14} aria-hidden />
                {t.wished}
              </p>
            ) : card.wish === "available" ? (
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className="mt-3 rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink"
              >
                {t.profileCard.sendWish}
              </button>
            ) : null}
          </>
        )}
      </div>
      {card.kind === "visitor" && sheetOpen && (
        <BirthdayWishSheet
          person={{ id: person.id, name: person.name }}
          onClose={() => setSheetOpen(false)}
          onSent={() => setWished(true)}
        />
      )}
    </div>
  );
}
