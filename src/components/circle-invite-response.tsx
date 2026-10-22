"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { respondToCircleInvite } from "@/app/actions/circles";
import { useCirclesText } from "@/components/circles-text";
import { aroundPlaceholder } from "@/lib/i18n/locales";

/** Shown on a PRIVATE Circle's page to someone with a pending CircleInvite to it: accept (become a member) or decline. */
export function CircleInviteResponse({
  inviteId,
  inviterName,
}: {
  inviteId: string;
  inviterName: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const t = useCirclesText().t.inviteResponse;
  const [before, after] = aroundPlaceholder(t.text, "name");

  function respond(accept: boolean) {
    startTransition(async () => {
      setError(null);
      const result = await respondToCircleInvite(inviteId, accept);
      if (result.error) {
        // invite_expired: the inviter can no longer invite, so the invite was withdrawn.
        setError(
          result.error === "unavailable" || result.error === "invite_expired"
            ? t.unavailable
            : accept
              ? t.acceptError
              : t.declineError,
        );
        // not_found: answered or cancelled meanwhile — the refresh shows the page as it now is (the Circle if they're in,
        // otherwise the 404 a PRIVATE Circle is to a non-member). invite_expired keeps the message on screen instead:
        // a refresh would replace it with that 404 and no explanation.
        if (result.error === "not_found") router.refresh();
        return;
      }
      // Declined: the Circle no longer exists for them (lib/circle-visibility.ts), so back to the Circles list.
      if (accept) router.refresh();
      else router.push("/circles");
    });
  }

  return (
    <div className="mt-8 rounded-xl border border-accent/40 bg-accent/5 p-4">
      <p className="text-sm">
        {before}
        <bdi className="font-semibold">{inviterName ?? t.someone}</bdi>
        {after}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => respond(true)}
          className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          {t.accept}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => respond(false)}
          className="rounded-lg border border-line px-4 py-2.5 text-sm disabled:opacity-50"
        >
          {t.decline}
        </button>
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
