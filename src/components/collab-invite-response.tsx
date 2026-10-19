"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { respondToCollabInvite } from "@/app/actions/collab";
import { useCollabText } from "@/components/collab-text";
import { aroundPlaceholder } from "@/lib/i18n/locales";

/** Shown to an invitee who hasn't yet responded to a PRIVATE collab's CollabInvite — this is their only way in. */
export function CollabInviteResponse({
  inviteId,
  inviterName,
  sessionLive = false,
}: {
  inviteId: string;
  inviterName: string | null;
  /** Someone is in the collab's live session right now — accepting lands them on this page with Join available. */
  sessionLive?: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const t = useCollabText().t.inviteResponse;
  const [before, after] = aroundPlaceholder(t.text, "name");

  return (
    <div className="rounded-xl border border-accent/40 bg-accent/5 p-4">
      <p className="text-sm">
        {before}
        <bdi className="font-semibold">{inviterName ?? t.someone}</bdi>
        {after}
      </p>
      {sessionLive && <p className="mt-1 text-sm font-medium text-accent">{t.sessionLive}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await respondToCollabInvite(inviteId, true);
              if (result.error) {
                // invite_expired: the inviter is no longer an admin, so the invite was withdrawn.
                setError(result.error === "invite_expired" ? t.unavailable : t.acceptError);
                // not_found: answered or cancelled meanwhile — the refresh shows the page as it now is. Not on
                // invite_expired: the collab is no longer visible to them (it would 404), so the message stays put.
                if (result.error === "not_found") router.refresh();
                return;
              }
              router.refresh();
            })
          }
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          {t.accept}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await respondToCollabInvite(inviteId, false);
              if (result.error) {
                setError(t.declineError);
                if (result.error === "not_found") router.refresh();
                return;
              }
              router.push("/collab");
            })
          }
          className="rounded-lg border border-line px-4 py-2.5 text-sm disabled:opacity-50"
        >
          {t.decline}
        </button>
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
