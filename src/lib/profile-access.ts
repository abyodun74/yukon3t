/**
 * Who may see a member's profile and what is on it (pure; the server half is profile-access-server.ts). One rule for
 * the pages (/u/[userId], its subscriber lists) and the Server Actions that page past or act on what those pages show
 * (loadMoreProfilePosts, loadMoreSubscribers/Subscribing, every Story action), so an action can't be called directly
 * to see more than the page would.
 */

/** The User columns these rules read. */
export const PROFILE_OWNER_SELECT = {
  id: true,
  status: true,
  name: true,
  isAdmin: true,
  isGuestPreview: true,
  postsVisibility: true,
} as const;

export type ProfileOwner = {
  id: string;
  status: string;
  name: string | null;
  isAdmin: boolean;
  isGuestPreview: boolean;
  postsVisibility: string;
};

/**
 * Whether the profile exists at all for this viewer: an ACTIVE, named account that isn't the shared guest-preview
 * identity, and not a site admin (admins are invisible platform-wide) unless it is the admin's own profile.
 */
export function profileIsListed(owner: ProfileOwner, viewerId: string): boolean {
  if (owner.status !== "ACTIVE" || !owner.name || owner.isGuestPreview) return false;
  return !owner.isAdmin || owner.id === viewerId;
}

/**
 * Whether the viewer may see the profile's posts and Stories (the page's account-level check; each post's own
 * audience is still applied by getVisiblePostsWhere): always the owner; never when the viewer has blocked them; never
 * a HIDDEN account (an admin-only, invisible-to-everyone tier); otherwise PUBLIC to anyone, CONNECTIONS_ONLY to accepted
 * connections.
 */
export function canSeeProfileContent(input: {
  owner: ProfileOwner;
  viewerId: string;
  iBlockedThem: boolean;
  connected: boolean;
}): boolean {
  const { owner, viewerId, iBlockedThem, connected } = input;
  if (owner.id === viewerId) return true;
  if (iBlockedThem || owner.postsVisibility === "HIDDEN") return false;
  return owner.postsVisibility === "PUBLIC" || connected;
}

/**
 * Stories: the profile's rule, plus no block in either direction (a Story is also reachable from chat, where a
 * forwarded copy can outlive the sender's connection to whoever it reached).
 */
export function canSeeStoriesOf(input: {
  owner: ProfileOwner;
  viewerId: string;
  blockedEitherWay: boolean;
  connected: boolean;
}): boolean {
  const { owner, viewerId, blockedEitherWay, connected } = input;
  if (owner.id === viewerId) return true;
  if (!profileIsListed(owner, viewerId) || blockedEitherWay) return false;
  return canSeeProfileContent({ owner, viewerId, iBlockedThem: false, connected });
}

/**
 * The Story-tray filter for other people's Stories (getConnectionsStories): the same account-level rule as
 * canSeeStoriesOf for authors who are all accepted connections, as a Prisma `author` filter.
 */
export const STORY_TRAY_AUTHOR_WHERE = {
  status: "ACTIVE",
  name: { not: null },
  isAdmin: false,
  isGuestPreview: false,
  postsVisibility: { not: "HIDDEN" },
} as const;
