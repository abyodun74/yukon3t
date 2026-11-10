import { BackButton } from "@/components/back-button";
import { BirthdayList } from "@/components/birthday-list";
import { GuestGatedScreen } from "@/components/guest-preview";
import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { getDictionary } from "@/lib/i18n/server";
import { loadTodaysBirthdays } from "@/lib/birthdays-data";

/**
 * Today's birthdays: the people whose birthday reminder you got (src/lib/birthdays.ts) and may still wish, each with
 * the quick-wish sheet. Where a reminder's bell row and push lead (?wish=<id> opens that person's sheet).
 */
export default async function BirthdaysPage({ searchParams }: { searchParams: Promise<{ wish?: string }> }) {
  const me = await getSessionUserOrRedirect();
  // Members only: a guest preview session (src/lib/guest-preview.ts) sees why, and how to join.
  if (me.isGuestPreview) return <GuestGatedScreen kind="notifications" />;
  const dictionary = await getDictionary();
  const t = dictionary.ui.birthdays;
  const [{ wish }, people] = await Promise.all([searchParams, loadTodaysBirthdays(me.id)]);

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <BackButton href="/home" label={dictionary.shell.common.back} />
      <h1 className="font-display text-2xl font-semibold">{t.title}</h1>
      <p className="mt-1 text-sm text-foreground-soft">{t.intro}</p>
      <BirthdayList people={people} initialWish={typeof wish === "string" ? wish : null} />
    </div>
  );
}
