"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addCollabCoAdmin,
  removeCollabCoAdmin,
  removeCollabParticipant,
} from "@/app/actions/collab";
import { UserLink } from "@/components/user-link";

type Participant = {
  role: string;
  user: { id: string; name: string | null; username?: string | null; avatarUrl?: string | null };
};

/** Author/co-admin only: promote participants to co-admin, demote co-admins, or remove them outright. Never lists the collab's original author — their participation can't be touched here. */
export function CollabParticipantManager({
  collabId,
  participants,
}: {
  collabId: string;
  participants: Participant[];
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  // Removing someone is disruptive and affects a third party's access, not
  // just the actor's own state — same reasoning as the moderation queue's
  // ban/suspend confirm step. It sits right next to the same-sized
  // "Make/Remove co-admin" toggle, so a mis-tap risk is real; that toggle
  // stays single-tap since it's reversible and lower-stakes.
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);

  const manageable = participants.filter((p) => p.role !== "OWNER");
  if (manageable.length === 0) {
    return <p className="text-sm text-foreground-soft">No other participants yet.</p>;
  }

  return (
    <ul className="divide-y divide-line">
      {manageable.map((p) => {
        const isCoAdmin = p.role === "MODERATOR";
        return (
          <li key={p.user.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="flex min-w-0 items-center gap-1.5">
              <UserLink userId={p.user.id} name={p.user.name} username={p.user.username} avatarUrl={p.user.avatarUrl} />
              {isCoAdmin && (
                <span className="text-xs font-normal text-accent">Co-admin</span>
              )}
            </span>
            <div className="flex shrink-0 items-center gap-2 text-xs">
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    if (isCoAdmin) await removeCollabCoAdmin(collabId, p.user.id);
                    else await addCollabCoAdmin(collabId, p.user.id);
                    router.refresh();
                  })
                }
                className="rounded-md border border-line px-2 py-2 font-medium hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {isCoAdmin ? "Remove co-admin" : "Make co-admin"}
              </button>
              {confirmingRemoveId === p.user.id ? (
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        await removeCollabParticipant(collabId, p.user.id);
                        setConfirmingRemoveId(null);
                        router.refresh();
                      })
                    }
                    className="rounded-md bg-danger px-2 py-2 font-medium text-white disabled:opacity-50"
                  >
                    Yes, remove
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingRemoveId(null)}
                    className="rounded-md px-2 py-2 font-medium text-foreground-soft hover:bg-line"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setConfirmingRemoveId(p.user.id)}
                  className="rounded-md border border-line px-2 py-2 font-medium text-danger hover:border-danger disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
