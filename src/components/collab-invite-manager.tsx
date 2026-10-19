"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, X } from "lucide-react";
import { cancelCollabInvite, inviteToCollab } from "@/app/actions/collab";
import { MultiSelect } from "@/components/multi-select";
import { UserLink } from "@/components/user-link";
import { useCollabText } from "@/components/collab-text";
import { useUiText } from "@/components/ui-text";
import { COLLAB_CIRCLE_IDS_MAX, COLLAB_CIRCLE_INVITE_MAX } from "@/lib/collab-circle-invite";
import { format, plural } from "@/lib/i18n/locales";

type Invite = {
  id: string;
  status: string;
  /** PENDING but no longer acceptable: whoever sent it is no longer an admin (isStaleCollabInvite). */
  stale: boolean;
  invitee: { id: string; name: string | null; username: string | null; avatarUrl: string | null };
};

/**
 * Organizer/co-admin only, shown on a PRIVATE collab: see who's been invited and invite more of your connections or
 * the members of Circles you created. `invites` is only what this viewer may see by name; `hiddenCount` is the rest
 * (see splitVisibleInvites). A pending invite can be cancelled; a stale one is labelled as no longer acceptable (still
 * cancellable, and its invitee is back among the candidates so it can be re-sent). Inviting and cancelling need
 * `canInvite` (canInviteToCollab); a site admin who isn't an admin of this collab only sees the list.
 */
export function CollabInviteManager({
  collabId,
  invites,
  totalCount,
  hiddenCount,
  candidates,
  circleCandidates,
  canInvite,
}: {
  collabId: string;
  invites: Invite[];
  totalCount: number;
  hiddenCount: number;
  canInvite: boolean;
  candidates: { value: string; label: string }[];
  circleCandidates: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { locale, t: collab } = useCollabText();
  const t = collab.invites;
  const listSeparator = useUiText().t.listSeparator;

  return (
    <div className="mt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
        {format(t.heading, { count: totalCount })}
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
                {canInvite && i.status === "PENDING" && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() =>
                      startTransition(async () => {
                        setError(null);
                        setNotice(null);
                        const result = await cancelCollabInvite(i.id);
                        // not_found: already answered or cancelled by someone else — the refresh shows which.
                        if (result.error && result.error !== "not_found") setError(t.cancelError);
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
      {hiddenCount > 0 && (
        <p className="mt-2 text-xs text-foreground-soft">{plural(locale, t.othersHidden, hiddenCount)}</p>
      )}

      {notice && <p role="status" className="mt-3 text-xs text-foreground-soft">{notice}</p>}
      {!open && error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}

      {canInvite && (candidates.length > 0 || circleCandidates.length > 0) &&
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
                setNotice(null);
                startTransition(async () => {
                  const result = await inviteToCollab(collabId, fd);
                  if (result.error) {
                    setError(result.error === "too_large" ? format(t.tooLarge, { max: COLLAB_CIRCLE_INVITE_MAX }) : t.error);
                    return;
                  }
                  if (result.circleNames.length > 0) {
                    setNotice(
                      result.invited > 0
                        ? format(plural(locale, t.circleInvited, result.invited), {
                            circles: result.circleNames.join(listSeparator),
                          })
                        : t.circleNoneNew,
                    );
                  }
                  setOpen(false);
                  router.refresh();
                });
              }}
              className="mt-2 space-y-3"
            >
              {candidates.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-foreground-soft">{t.connectionsLabel}</label>
                  <div className="mt-1">
                    <MultiSelect
                      name="inviteeIds"
                      options={candidates}
                      placeholder={t.placeholder}
                      labels={collab.controls.multiSelect}
                    />
                  </div>
                </div>
              )}
              {circleCandidates.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-foreground-soft">{t.circleLabel}</label>
                  <p className="mt-0.5 text-xs text-foreground-soft">{t.circleHint}</p>
                  <div className="mt-1">
                    <MultiSelect
                      name="circleIds"
                      options={circleCandidates}
                      placeholder={t.circlePlaceholder}
                      max={COLLAB_CIRCLE_IDS_MAX}
                      labels={collab.controls.multiSelect}
                    />
                  </div>
                </div>
              )}
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
