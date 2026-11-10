// The "+" on your own profile picture (the "Your story" ring on Home, the avatar on your own profile) opens a small
// picker: Story, Feed post or Muse. Each choice leads to that type's existing composer; nothing here creates content.
// Pure so the order and the feed-post destination are unit-tested (src/lib/create-picker.test.ts).

export const CREATE_PICKER_KINDS = ["story", "feed", "muse"] as const;
export type CreatePickerKind = (typeof CREATE_PICKER_KINDS)[number];

/** The id of the own-profile post composer's wrapper on /u/<id> (src/app/u/[userId]/page.tsx). */
export const PROFILE_COMPOSER_ID = "profile-composer";

/**
 * Where "Feed post" goes when the composer isn't on the current screen: your own profile, whose ProfileComposeFocus
 * scrolls to and focuses the composer on `?compose=1` (same destination as Home's "New post" quick action).
 */
export function feedComposeHref(userId: string): string {
  return `/u/${encodeURIComponent(userId)}?compose=1`;
}
