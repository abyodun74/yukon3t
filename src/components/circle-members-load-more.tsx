"use client";

import { useCirclesText } from "@/components/circles-text";

/** The "Load more members" button under each of a Circle's member lists (see useCircleMemberPages). */
export function CircleMembersLoadMore({
  hasMore,
  loading,
  failed,
  onLoadMore,
  compact = false,
}: {
  hasMore: boolean;
  loading: boolean;
  failed: boolean;
  onLoadMore: () => void;
  /** Inside a sheet's small scrolling list. */
  compact?: boolean;
}) {
  const t = useCirclesText().t.members;
  if (!hasMore) return null;
  return (
    <div className={compact ? "mt-2" : "mt-3"}>
      <button
        type="button"
        onClick={onLoadMore}
        disabled={loading}
        className="w-full rounded-lg border border-line px-3 py-2 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50"
      >
        {loading ? t.loadingMore : t.loadMore}
      </button>
      {failed && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {t.loadFailed}
        </p>
      )}
    </div>
  );
}
