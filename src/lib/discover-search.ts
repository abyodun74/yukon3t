import { UNVERIFIED_ACCOUNT_WHERE } from "@/lib/account-verification";
import type { ConnectionStatus } from "@/lib/engagement-status";

// Searching people by name or @username from Discover (searchDiscoverPeople in actions/discover.ts, the search icon
// in components/discover-people-search.tsx). Pure: the rules the action and its tests share.

export const DISCOVER_SEARCH_MIN_LENGTH = 2;
export const DISCOVER_SEARCH_MAX_LENGTH = 50;
export const DISCOVER_SEARCH_PAGE_SIZE = 20;
/** Hard cap on how far a single query can page. A broad query gets "refine your search", never the whole directory. */
export const DISCOVER_SEARCH_MAX_RESULTS = 60;
export const DISCOVER_SEARCH_MAX_PAGES = DISCOVER_SEARCH_MAX_RESULTS / DISCOVER_SEARCH_PAGE_SIZE;
/** How long the box waits after the last keystroke before asking the server. */
export const DISCOVER_SEARCH_DEBOUNCE_MS = 300;

/**
 * The query as it is searched, or null when it is too short to search. Trims, drops a leading "@" (people type
 * usernames that way), collapses whitespace, removes the LIKE metacharacters `%` and `\` (a query must not become a
 * match-everything pattern), and needs at least two letters or digits so punctuation alone can't page the directory.
 * Anything past the maximum length is cut off rather than refused.
 */
export function normalizeDiscoverSearchQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const query = raw
    .replace(/[%\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^@+/, "")
    .trim()
    .slice(0, DISCOVER_SEARCH_MAX_LENGTH)
    .trim();
  const meaningful = query.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  if (query.length < DISCOVER_SEARCH_MIN_LENGTH || meaningful < DISCOVER_SEARCH_MIN_LENGTH) return null;
  return query;
}

/** A 1-based page number from the client, or null when it is out of range (past the cap, not a whole number). */
export function discoverSearchPage(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isInteger(raw)) return null;
  if (raw < 1 || raw > DISCOVER_SEARCH_MAX_PAGES) return null;
  return raw;
}

/**
 * Who a Discover search may return. The same people Discover itself lists (active, named, "Show my profile in
 * Discover" on, never a site admin or the guest-preview identity), and additionally only verified accounts. Unlike the
 * Discover grid, people you are already connected with or have a request with are included, so the row can show
 * Requested / Accept / Connected. Matching is a substring of the display name or username, the same for every query,
 * so an exact username gets no different treatment than a partial one.
 */
export function discoverSearchUserWhere(viewerId: string, excludedIds: Iterable<string>, query: string) {
  return {
    id: { notIn: [viewerId, ...excludedIds] },
    status: "ACTIVE" as const,
    name: { not: null },
    discoverable: true,
    isAdmin: false,
    isGuestPreview: false,
    NOT: UNVERIFIED_ACCOUNT_WHERE,
    OR: [
      { name: { contains: query, mode: "insensitive" as const } },
      { username: { contains: query, mode: "insensitive" as const } },
    ],
  };
}

export type DiscoverSearchState = "none" | "requested" | "incoming" | "connected";

/** What the row's button says, from the viewer's side of the connection row between the two (if any). */
export function discoverSearchState(
  connection: { status: Exclude<ConnectionStatus, null>; requesterId: string } | undefined,
  viewerId: string,
): DiscoverSearchState {
  if (!connection) return "none";
  if (connection.status === "ACCEPTED") return "connected";
  if (connection.status === "PENDING") return connection.requesterId === viewerId ? "requested" : "incoming";
  // A declined request can be sent again, exactly as ConnectButton treats it everywhere else.
  return "none";
}

/**
 * The connection row that decides the state when the pair has two (each side once requested the other): an accepted
 * one wins, then a pending one, then anything else.
 */
export function pickDiscoverSearchConnection<T extends { status: Exclude<ConnectionStatus, null> }>(rows: T[]): T | undefined {
  const rank = (row: T) => (row.status === "ACCEPTED" ? 0 : row.status === "PENDING" ? 1 : 2);
  return [...rows].sort((a, b) => rank(a) - rank(b))[0];
}
