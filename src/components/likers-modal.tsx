"use client";

import { useEffect, useState } from "react";
import { UserLink } from "@/components/user-link";
import { getPostLikers } from "@/app/actions/likes";
import { Sheet } from "@/components/sheet";

type Liker = { id: string; name: string | null; username: string | null; avatarUrl: string | null };

/**
 * "Liked by" list, opened from a post's like count. Migrated onto the
 * shared Sheet component (see that file) — one real behavior change this
 * required: the caller now renders this unconditionally once it's ever
 * been opened (AnimatePresence needs the component mounted through its
 * own exit animation, which a parent's `{open && <LikersModal/>}`
 * wouldn't allow — see post-card.tsx), so the old "fetch once on mount"
 * effect is now keyed on `open` itself and re-fetches every time it
 * reopens, preserving the original "always shows current likers, not a
 * stale list from last time" behavior.
 */
export function LikersModal({ postId, open, onClose }: { postId: string; open: boolean; onClose: () => void }) {
  const [likers, setLikers] = useState<Liker[] | null>(null);

  // Clears stale data from a previous open the moment it reopens, so it
  // shows "Loading…" immediately instead of briefly flashing last time's
  // list — adjusted during render (React's documented pattern for this)
  // rather than inside the effect below, which this project's lint config
  // flags for a synchronous setState call at the top of an effect body.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setLikers(null);
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getPostLikers(postId).then((result) => {
      if (!cancelled) setLikers(result.likers);
    });
    return () => {
      cancelled = true;
    };
  }, [postId, open]);

  return (
    <Sheet open={open} onClose={onClose} title="Liked by">
      <ul className="max-h-80 space-y-2.5 overflow-y-auto">
        {likers === null && <li className="text-sm text-foreground-soft">Loading…</li>}
        {likers?.length === 0 && <li className="text-sm text-foreground-soft">No likes yet.</li>}
        {likers?.map((liker) => (
          <li key={liker.id}>
            <UserLink
              userId={liker.id}
              name={liker.name}
              username={liker.username}
              avatarUrl={liker.avatarUrl}
              avatarSize={28}
              className="text-sm"
            />
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
