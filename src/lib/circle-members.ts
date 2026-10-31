/**
 * Paging a Circle's member list (pure, client-safe). A big Circle used to send every member, with name and avatar,
 * three times over in the page's payload (the member list or manager, the private-channel access picker and the
 * voice-room invite picker). Now the page sends the first CIRCLE_MEMBERS_PAGE_SIZE and each of those lists asks for
 * more with "Load more" (loadCircleMembers in actions/circles.ts, server half in circle-members-data.ts).
 *
 * Order: oldest membership first (the owner, who joined at creation, leads), ties broken by id, so a keyset cursor
 * (joinedAt, id) never skips or repeats a member while people join or leave between pages.
 */

export const CIRCLE_MEMBERS_PAGE_SIZE = 50;

export type CircleMemberCursor = { joinedAt: string; id: string };

export type CircleMemberView = {
  /** The CircleMembership row's id: the cursor's tiebreak, never shown. */
  membershipId: string;
  joinedAt: string;
  role: string;
  user: { id: string; name: string | null; username: string | null; avatarUrl: string | null };
  /** Only when the page was asked for a private channel's access list (admins only): whether this member is on it. */
  hasChannelAccess?: boolean;
};

export type CircleMemberPage = { members: CircleMemberView[]; nextCursor: CircleMemberCursor | null };

/** Prisma `where` for the members after `cursor` (all of them when there is none), in the order above. */
export function circleMemberPageWhere(circleId: string, cursor: CircleMemberCursor | null) {
  if (!cursor) return { circleId };
  const joinedAt = new Date(cursor.joinedAt);
  return {
    circleId,
    OR: [{ joinedAt: { gt: joinedAt } }, { joinedAt, id: { gt: cursor.id } }],
  };
}

export const CIRCLE_MEMBER_ORDER = [{ joinedAt: "asc" as const }, { id: "asc" as const }];

/**
 * Rows were fetched with `take: pageSize + 1`: the extra row only says whether there is a next page, it isn't shown.
 * The cursor is the last row actually shown.
 */
export function splitCircleMemberPage<T extends { membershipId: string; joinedAt: string }>(
  rows: T[],
  pageSize: number = CIRCLE_MEMBERS_PAGE_SIZE,
): { members: T[]; nextCursor: CircleMemberCursor | null } {
  const members = rows.slice(0, pageSize);
  const last = members[members.length - 1];
  return {
    members,
    nextCursor: rows.length > pageSize && last ? { joinedAt: last.joinedAt, id: last.membershipId } : null,
  };
}

/** Appends a loaded page, dropping anyone already listed (a refreshed first page can overlap what was loaded). */
export function appendCircleMemberPage<T extends { user: { id: string } }>(current: T[], page: T[]): T[] {
  const seen = new Set(current.map((m) => m.user.id));
  return [...current, ...page.filter((m) => !seen.has(m.user.id))];
}
