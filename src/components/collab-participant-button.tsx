"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { joinCollab, leaveCollab } from "@/app/actions/collab";
import { useCollabText } from "@/components/collab-text";
import { byCode } from "@/lib/i18n/locales";

export function CollabParticipantButton({
  collabId,
  isParticipant,
  isOwner,
  hasPendingRequest,
}: {
  collabId: string;
  isParticipant: boolean;
  isOwner: boolean;
  hasPendingRequest: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justRequested, setJustRequested] = useState(false);
  const router = useRouter();
  const t = useCollabText().t.participation;

  if (isOwner) {
    return (
      <span className="rounded-lg border border-line px-4 py-1.5 text-sm text-foreground-soft">
        {t.owner}
      </span>
    );
  }

  if (!isParticipant && (hasPendingRequest || justRequested)) {
    return (
      <span className="rounded-lg border border-line px-4 py-1.5 text-sm text-foreground-soft">
        {t.pending}
      </span>
    );
  }

  return (
    <div>
      <button data-guest-block
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = isParticipant ? await leaveCollab(collabId) : await joinCollab(collabId);
            if (result.error) {
              setError(byCode(t.errors, result.error));
              return;
            }
            if (!isParticipant && "requested" in result && result.requested) {
              setJustRequested(true);
            }
            router.refresh();
          })
        }
        className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50"
      >
        {isParticipant ? t.leave : t.request}
      </button>
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
