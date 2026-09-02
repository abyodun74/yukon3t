/** Own-home-feed-only nudge: shows the current streak and, if today's activity hasn't landed yet, a reminder to post before it lapses. */
export function StreakBanner({
  currentStreak,
  longestStreak,
  activeToday,
}: {
  currentStreak: number;
  longestStreak: number;
  activeToday: boolean;
}) {
  if (currentStreak === 0) return null;

  return (
    <div className="animate-rise-in flex items-center justify-between gap-3 rounded-xl border border-line px-4 py-2.5 text-sm">
      <span>
        🔥 <strong>{currentStreak}-day streak</strong>
        {longestStreak > currentStreak && (
          <span className="text-foreground-soft"> · best: {longestStreak}</span>
        )}
      </span>
      {!activeToday && (
        <span className="text-xs text-foreground-soft">
          Post or message today to keep it going
        </span>
      )}
    </div>
  );
}
