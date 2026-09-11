/** Own-home-feed-only nudge: shows the current streak. */
export function StreakBanner({
  currentStreak,
  longestStreak,
}: {
  currentStreak: number;
  longestStreak: number;
}) {
  if (currentStreak === 0) return null;

  return (
    <div className="animate-rise-in flex items-center gap-3 rounded-xl border border-line px-4 py-2.5 text-sm">
      <span>
        🔥 <strong>{currentStreak}-day streak</strong>
        {longestStreak > currentStreak && (
          <span className="text-foreground-soft"> · best: {longestStreak}</span>
        )}
      </span>
    </div>
  );
}
