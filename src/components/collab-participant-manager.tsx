"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addCollabCoAdmin,
  removeCollabCoAdmin,
  removeCollabParticipant,
} from "@/app/actions/collab";

type Participant = {
  role: string;
  user: { id: string; name: string | null };
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
            <span className="min-w-0 truncate">
              {p.user.name}
              {isCoAdmin && (
                <span className="ml-1.5 text-xs font-normal text-accent">Co-admin</span>
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
                className="rounded-md border border-line px-2 py-1 font-medium hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {isCoAdmin ? "Remove co-admin" : "Make co-admin"}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    await removeCollabParticipant(collabId, p.user.id);
                    router.refresh();
                  })
                }
                className="rounded-md border border-line px-2 py-1 font-medium text-danger hover:border-danger disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
