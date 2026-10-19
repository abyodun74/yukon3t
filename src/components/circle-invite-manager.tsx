"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, X } from "lucide-react";
import { cancelCircleInvite, inviteToCircle } from "@/app/actions/circles";
import { MultiSelect } from "@/components/multi-select";
import { UserLink } from "@/components/user-link";
import { useCirclesText } from "@/components/circles-text";
import { CIRCLE_INVITE_MAX } from "@/lib/circle-invite";
import { format, plural } from "@/lib/i18n/locales";

type Invite = {
  id: string;
  status: string;
  /** PENDING but no longer acceptable: whoever sent it is no longer an admin (isStaleCircleInvite). */
  stale: boolean;
  invitee: { id: string; name: string | null; username: string | null; avatarUrl: string | null };
};

/**
 * Owner/co-admin only, shown on a PRIVATE Circle: invite your connections, and see every invite (whoever sent it)
 * with its status; a pending one can be cancelled. A stale one is labelled as no longer acceptable (still
 * cancellable, and its invitee stays in the picker so it can be re-sent). `candidates` are already filtered (see
 * eligibleCircleInvitees).
 */
export function CircleInviteManager({
  circleId,
  invites,
  candidates,
}: {
  circleId: string;
  invites: Invite[];
  candidates: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { locale, t: circles } = useCirclesText();
  const t = circles.invites;

  function errorText(code: string) {
    if (code === "too_many") return format(t.tooMany, { max: CIRCLE_INVITE_MAX });
    if (code === "rate_limited") return t.rateLimited;
    return t.error;
  }

  return (
    <div className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
        {format(t.heading, { count: invites.length })}
      </h2>
      <p className="mt-1 text-xs text-foreground-soft">{t.note}</p>

      {invites.length > 0 && (
        <div className="mt-3 space-y-2">
          {invites.map((i) => (
            <div
              key={i.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2"
            >
              <div className="min-w-0">
                <UserLink
                  userId={i.invitee.id}
                  name={i.invitee.name}
                  username={i.invitee.username}
                  avatarUrl={i.invitee.avatarUrl}
                  avatarSize={28}
                />
                {i.status === "PENDING" && i.stale && (
                  <p className="mt-1 text-xs text-foreground-soft">{t.stale}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!(i.status === "PENDING" && i.stale) && (
                  <span className="text-xs text-foreground-soft">
                    {i.status === "PENDING" ? t.pending : i.status === "ACCEPTED" ? t.accepted : t.declined}
                  </span>
                )}
                {i.status === "PENDING" && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        setError(null);
                        setNotice(null);
                        const result = await cancelCircleInvite(i.id);
                        // not_found: already answered or cancelled by someone else — the refresh shows which.
                        if (result.error && result.error !== "not_found") {
                          setError(result.error === "rate_limited" ? t.rateLimited : t.cancelError);
                        }
                        router.refresh();
                      })
                    }
                    className="rounded-md border border-line px-2.5 py-1 text-xs disabled:opacity-50"
                  >
                    {t.cancel}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {notice && <p role="status" className="mt-3 text-xs text-foreground-soft">{notice}</p>}
      {!open && error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}

      {candidates.length === 0 ? (
        <p className="mt-3 text-xs text-foreground-soft">{t.noCandidates}</p>
      ) : open ? (
        <div className="mt-3 w-full rounded-lg border border-line p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{t.title}</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t.close}
              className="rounded-lg p-1 text-foreground-soft hover:bg-line"
            >
              <X size={14} />
            </button>
          </div>
          <form
            action={(fd) => {
              setError(null);
              setNotice(null);
              startTransition(async () => {
                const result = await inviteToCircle(circleId, fd);
                if (result.error) {
                  setError(errorText(result.error));
                  return;
                }
                const parts = [
                  result.invited > 0 ? plural(locale, t.invited, result.invited) : null,
                  result.approved > 0 ? plural(locale, t.approved, result.approved) : null,
                ].filter((p): p is string => p !== null);
                setNotice(parts.length > 0 ? parts.join(" ") : t.noneNew);
                setOpen(false);
                router.refresh();
              });
            }}
            className="mt-2 space-y-3"
          >
            <MultiSelect
              name="inviteeIds"
              options={candidates}
              placeholder={t.placeholder}
              max={CIRCLE_INVITE_MAX}
              labels={circles.controls.multiSelect}
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
      )}
    </div>
  );
}
