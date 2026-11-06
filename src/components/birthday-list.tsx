"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { UserAvatar } from "@/components/user-link";
import { useUiText } from "@/components/ui-text";
import { BirthdayWishSheet } from "@/components/birthday-wish-sheet";
import { BIRTHDAYS_HREF, birthdayWishHref, type TodaysBirthday } from "@/lib/birthdays";

/**
 * Today's birthdays (/birthdays), each with "Send wishes". `initialWish` (the ?wish= of a reminder's link) opens that
 * person's quick-wish sheet straight away. The address follows the open sheet, so NotificationReadOnVisit marks that
 * person's reminder read when it opens, the same as arriving from its push.
 */
export function BirthdayList({ people, initialWish }: { people: TodaysBirthday[]; initialWish: string | null }) {
  const { t: ui } = useUiText();
  const t = ui.birthdays;
  const [wished, setWished] = useState(() => new Set(people.filter((p) => p.wished).map((p) => p.id)));
  const [openId, setOpenId] = useState<string | null>(() =>
    initialWish && people.some((p) => p.id === initialWish && !p.wished) ? initialWish : null,
  );
  const open = people.find((p) => p.id === openId) ?? null;

  function openFor(id: string | null) {
    setOpenId(id);
    window.history.replaceState(null, "", id ? birthdayWishHref(id) : BIRTHDAYS_HREF);
  }

  if (people.length === 0) {
    return <p className="mt-6 text-sm text-foreground-soft">{t.empty}</p>;
  }

  return (
    <>
      <ul className="mt-6 divide-y divide-line">
        {people.map((person) => {
          const done = wished.has(person.id);
          return (
            <li key={person.id} className="flex items-center gap-3 py-3">
              <Link href={`/u/${person.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <UserAvatar avatarUrl={person.avatarUrl} name={person.name} size={40} />
                <span className="min-w-0">
                  <span dir="auto" className="block truncate font-medium">
                    {person.name ?? ui.unknownName}
                  </span>
                  {person.username && (
                    <span dir="ltr" className="block truncate text-xs text-foreground-soft">
                      @{person.username}
                    </span>
                  )}
                </span>
              </Link>
              {done ? (
                <span className="flex items-center gap-1 text-sm text-success">
                  <Check size={14} aria-hidden />
                  {t.wished}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => openFor(person.id)}
                  className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink"
                >
                  {t.sendWishes}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <BirthdayWishSheet
        person={open ? { id: open.id, name: open.name } : null}
        onClose={() => openFor(null)}
        onSent={(id) => setWished((prev) => new Set(prev).add(id))}
      />
    </>
  );
}
