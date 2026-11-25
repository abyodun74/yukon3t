"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { Cake, Check, Sparkles } from "lucide-react";
import { useUiText } from "@/components/ui-text";
import { BirthdayMoment } from "@/components/birthday-moment";
import { BirthdayWishSheet } from "@/components/birthday-wish-sheet";
import type { ProfileBirthdayCard as Card } from "@/lib/birthdays";
import {
  BIRTHDAY_MOMENT_SEEN_KEY,
  birthdayMomentDayKey,
  shouldAutoPlayBirthdayMoment,
} from "@/lib/birthday-moment";
import { format } from "@/lib/i18n/locales";

/**
 * YuKon3t's birthday card at the top of a profile, on that person's birthday (all day in their own time zone; decided
 * on the server by loadProfileBirthdayCard). The owner sees "Happy birthday from YuKon3t", a link to the setting and
 * "Play your birthday moment" (birthday-moment.tsx: the full-screen reveal with the wishes received so far), which
 * also plays by itself the first time they open their profile that day on this device (not when the page was opened
 * for a story). A visitor in the chosen audience sees whose birthday it is and, when their own reminder allows it,
 * "Send a wish", which opens the same quick-wish sheet as /birthdays. The card itself is still; all the movement is in
 * the moment, which has its own reduced-motion fade. Says "today" only: never a date, a year or an age.
 *
 * Phase A: when digital gifts are on for both people, the page passes its "Send a gift" button (`giftAction`, rendered
 * only where giftsEnabledFor allows); a visitor's calls to action are then "Send a wish" first and "Send a gift"
 * second. The gift picker opens on its "Right now" shelf (the birthday occasion), every rule checked on the server.
 */
export function ProfileBirthdayCard({
  card,
  person,
  giftAction = null,
  autoPlayMoment = true,
}: {
  card: Card;
  person: { id: string; name: string | null };
  giftAction?: ReactNode;
  /** The owner's moment may play by itself (once a day per device); off when the page opened for something else. */
  autoPlayMoment?: boolean;
}) {
  const { t: ui, dir, locale } = useUiText();
  const t = ui.birthdays;
  const headingId = useId();
  const [wished, setWished] = useState(card.kind === "visitor" && card.wish === "wished");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [momentOpen, setMomentOpen] = useState(false);
  const name = person.name ?? ui.unknownName;
  const own = card.kind === "own";

  useEffect(() => {
    if (!own || !autoPlayMoment) return;
    const today = birthdayMomentDayKey(new Date());
    let seen: string | null = null;
    try {
      seen = window.localStorage.getItem(BIRTHDAY_MOMENT_SEEN_KEY);
    } catch {
      // Storage refused (private mode, a locked-down WebView): it then plays from the button only.
      return;
    }
    if (!shouldAutoPlayBirthdayMoment(seen, today)) return;
    try {
      window.localStorage.setItem(BIRTHDAY_MOMENT_SEEN_KEY, today);
    } catch {
      return;
    }
    // Device storage (and the device's own date) only exist after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMomentOpen(true);
  }, [own, autoPlayMoment]);

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
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <button
                type="button"
                onClick={() => setMomentOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink"
              >
                <Sparkles size={14} aria-hidden />
                {t.profileCard.playMoment}
              </button>
              <Link href="/settings#birthdays" className="text-sm text-accent hover:underline">
                {t.profileCard.ownSettings}
              </Link>
            </div>
          </>
        ) : (
          <>
            <h2 id={headingId} dir="auto" className="break-words font-semibold">
              {format(t.profileCard.visitorTitle, { name })}
            </h2>
            <p dir="auto" className="mt-1 text-sm text-foreground-soft">
              {format(t.profileCard.visitorBody, { name })}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {wished ? (
                <p className="flex items-center gap-1 text-sm text-success">
                  <Check size={14} aria-hidden />
                  {t.wished}
                </p>
              ) : card.wish === "available" ? (
                <button
                  type="button"
                  onClick={() => setSheetOpen(true)}
                  className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink"
                >
                  {t.profileCard.sendWish}
                </button>
              ) : null}
              {giftAction}
            </div>
          </>
        )}
      </div>
      {card.kind === "own" && momentOpen && (
        <BirthdayMoment
          variant="celebrant"
          name={person.name}
          wishes={card.wishes}
          action={{ label: t.moment.openMessages, href: "/messages" }}
          onClose={() => setMomentOpen(false)}
        />
      )}
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
