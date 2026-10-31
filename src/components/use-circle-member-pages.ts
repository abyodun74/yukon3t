"use client";

import { useState } from "react";
import { loadCircleMembers } from "@/app/actions/circles";
import { appendCircleMemberPage, type CircleMemberPage, type CircleMemberView } from "@/lib/circle-members";

/**
 * A Circle's member list as the server sent it (`initial`, the first page) plus whatever "Load more" fetched since
 * (lib/circle-members.ts). The first page always comes from the prop, so a router.refresh() after promoting, removing
 * or granting access updates it in place; pages loaded later are kept across that refresh, and `patch`/`remove` keep
 * them in step with what this screen just did.
 */
export function useCircleMemberPages(circleId: string, initial: CircleMemberPage, channelId: string | null = null) {
  const [more, setMore] = useState<CircleMemberView[]>([]);
  // undefined = nothing loaded past the first page yet, so the first page's own cursor applies.
  const [moreCursor, setMoreCursor] = useState<CircleMemberPage["nextCursor"] | undefined>(undefined);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const members = appendCircleMemberPage(initial.members, more).filter((m) => !removed.has(m.user.id));
  const nextCursor = moreCursor === undefined ? initial.nextCursor : moreCursor;

  async function loadMore() {
    if (!nextCursor || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const result = await loadCircleMembers({ circleId, cursor: nextCursor, channelId });
      if (result.error !== null) {
        setFailed(true);
        return;
      }
      setMore((current) => appendCircleMemberPage(current, result.members));
      setMoreCursor(result.nextCursor);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  /** Updates a member loaded by "Load more" (the first page is refreshed from the server instead). */
  function patch(userId: string, change: Partial<Pick<CircleMemberView, "role" | "hasChannelAccess">>) {
    setMore((current) => current.map((m) => (m.user.id === userId ? { ...m, ...change } : m)));
  }

  function remove(userId: string) {
    setRemoved((current) => new Set(current).add(userId));
  }

  return { members, hasMore: nextCursor !== null, loadMore, loading, failed, patch, remove };
}
