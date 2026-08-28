"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { UserLink } from "@/components/user-link";
import { getPostLikers } from "@/app/actions/likes";

type Liker = { id: string; name: string | null; username: string | null; avatarUrl: string | null };

/** "Liked by" list, opened from a post's like count — fetched lazily on open, same pattern as story-viewer.tsx's viewers panel. */
export function LikersModal({ postId, onClose }: { postId: string; onClose: () => void }) {
  const [likers, setLikers] = useState<Liker[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPostLikers(postId).then((result) => {
      if (!cancelled) setLikers(result.likers);
    });
    return () => {
      cancelled = true;
    };
  }, [postId]);

  return (
    <div
      className="animate-modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="animate-modal-panel-in w-full max-w-sm rounded-xl bg-surface p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Liked by</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-foreground-soft hover:text-danger"
          >
            <X size={18} />
          </button>
        </div>

        <ul className="mt-3 max-h-80 space-y-2.5 overflow-y-auto">
          {likers === null && <li className="text-sm text-foreground-soft">Loading…</li>}
          {likers?.length === 0 && (
            <li className="text-sm text-foreground-soft">No likes yet.</li>
          )}
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
      </div>
    </div>
  );
}
