import { format, plural } from "@/lib/i18n/locales";
import { getDictionary, getLocale } from "@/lib/i18n/server";

/** Own-home-feed-only nudge: shows the current streak. */
export async function StreakBanner({
  currentStreak,
  longestStreak,
}: {
  currentStreak: number;
  longestStreak: number;
}) {
  if (currentStreak === 0) return null;
  const locale = await getLocale();
  const t = (await getDictionary()).feed.streak;

  return (
    <div className="animate-rise-in flex items-center gap-3 rounded-xl border border-line px-4 py-2.5 text-sm">
      <span>
        🔥 <strong>{plural(locale, t.days, currentStreak)}</strong>
        {longestStreak > currentStreak && (
          <span className="text-foreground-soft"> · {format(t.best, { count: longestStreak })}</span>
        )}
      </span>
    </div>
  );
}
