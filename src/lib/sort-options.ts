// The sort choices of /discover and /search, shared by each page and the Server Action that loads its next page
// ("use server" files can only export async functions, so the lists can't live in the action files).

export const DISCOVER_SORT_OPTIONS = ["relevant", "recent", "oldest", "online"] as const;
export type DiscoverSortOption = (typeof DISCOVER_SORT_OPTIONS)[number];

export const SEARCH_SORT_OPTIONS = ["relevant", "recent", "oldest", "current"] as const;
export type SearchSortOption = (typeof SEARCH_SORT_OPTIONS)[number];
