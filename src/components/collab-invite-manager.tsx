"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, X } from "lucide-react";
import { inviteToCollab } from "@/app/actions/collab";
import { MultiSelect } from "@/components/multi-select";
import { UserLink } from "@/components/user-link";
import { useCollabText } from "@/components/collab-text";
import { format } from "@/lib/i18n/locales";

type Invite = {
  id: string;
  status: string;
  invitee: { id: string; name: string | null; username: string | null; avatarUrl: string | null };
};

/** Organizer/co-admin only, shown on a PRIVATE collab: see who's been invited and invite more of your connections. */
export function CollabInviteManager({
  collabId,
  invites,
  candidates,
}: {
  collabId: string;
  invites: Invite[];
  candidates: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { t: collab } = useCollabText();
  const t = collab.invites;

  return (
    <div className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
        {format(t.heading, { count: invites.length })}
      </h2>
      <p className="mt-1 text-xs text-foreground-soft">
        {t.note}
      </p>

      {invites.length > 0 && (
        <div className="mt-3 space-y-2">
          {invites.map((i) => (
            <div
              key={i.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2"
            >
              <UserLink
                userId={i.invitee.id}
                name={i.invitee.name}
                username={i.invitee.username}
                avatarUrl={i.invitee.avatarUrl}
                avatarSize={28}
              />
              <span className="text-xs text-foreground-soft">
                {i.status === "PENDING" ? t.pending : i.status === "ACCEPTED" ? t.accepted : t.declined}
              </span>
            </div>
          ))}
        </div>
      )}

      {candidates.length > 0 &&
        (open ? (
          <div className="mt-3 w-full rounded-lg border border-line p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{t.title}</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t.cancel}
                className="rounded-lg p-1 text-foreground-soft hover:bg-line"
              >
                <X size={14} />
              </button>
            </div>
            <form
              action={(fd) => {
                setError(null);
                startTransition(async () => {
                  const result = await inviteToCollab(collabId, fd);
                  if (result.error) {
                    setError(t.error);
                  } else {
                    setOpen(false);
                    router.refresh();
                  }
                });
              }}
              className="mt-2"
            >
              <MultiSelect
                name="inviteeIds"
                options={candidates}
                placeholder={t.placeholder}
                labels={collab.controls.multiSelect}
              />
              {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
              <button
                type="submit"
                disabled={isPending}
                className="mt-2 w-full rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink disabled:opacity-50"
              >
                {isPending ? t.inviting : t.invite}
              </button>
            </form>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-3 flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-foreground-soft hover:border-accent hover:text-accent"
          >
            <UserPlus size={13} />
            {t.open}
          </button>
        ))}
    </div>
  );
}
