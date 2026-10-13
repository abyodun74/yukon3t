"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { updateChannel, deleteChannel, addChannelMember, removeChannelMember } from "@/app/actions/channels";
import { UserLink } from "@/components/user-link";
import { Sheet } from "@/components/sheet";
import { useCirclesText } from "@/components/circles-text";
import { aroundPlaceholder, byCode } from "@/lib/i18n/locales";

type CircleMember = { id: string; name: string | null; username: string | null; avatarUrl: string | null };

export function ChannelSettingsModal({
  channel,
  circleSlug,
  circleMembers,
  channelMemberIds,
}: {
  channel: { id: string; name: string; topic: string | null; visibility: "PUBLIC" | "PRIVATE"; type: "TEXT" | "VOICE" };
  circleSlug: string;
  circleMembers: CircleMember[];
  channelMemberIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const t = useCirclesText().t.channels;
  // "#general" is one unit whatever direction the sentence around it runs in.
  const channelName = <bdi>#{channel.name}</bdi>;
  const [titleBefore, titleAfter] = aroundPlaceholder(t.settingsTitle, "channel");
  const [deleteBefore, deleteAfter] = aroundPlaceholder(t.deleteConfirm, "channel");

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await updateChannel(channel.id, formData);
      if (result.error) {
        setError(byCode(t.errors, result.error));
        return;
      }
      router.refresh();
    });
  }

  const memberIdSet = new Set(channelMemberIds);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t.settingsLabel}
        className="rounded-lg p-1.5 text-foreground-soft hover:bg-line hover:text-accent"
      >
        <Settings size={16} />
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={
          <span className="break-words">
            {titleBefore}
            {channelName}
            {titleAfter}
          </span>
        }
        panelClassName="max-h-[85vh] overflow-y-auto"
      >
        <form action={handleSubmit} className="space-y-3 text-sm">
          <div>
            <label className="text-xs font-medium text-foreground-soft">{t.name}</label>
            <input
              aria-label={t.name}
              name="name"
              dir="auto"
              defaultValue={channel.name}
              required
              minLength={2}
              maxLength={50}
              className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground-soft">{t.topic}</label>
            <input
              aria-label={t.topic}
              name="topic"
              dir="auto"
              defaultValue={channel.topic ?? ""}
              maxLength={200}
              className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground-soft">{t.privacy}</label>
            <div className="mt-1 flex gap-4">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="visibility" value="PUBLIC" defaultChecked={channel.visibility === "PUBLIC"} />{" "}
                {t.public}
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="visibility" value="PRIVATE" defaultChecked={channel.visibility === "PRIVATE"} />{" "}
                {t.privateOption}
              </label>
            </div>
          </div>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50"
          >
            {isPending ? t.saving : t.save}
          </button>
        </form>

        {channel.visibility === "PRIVATE" && (
          <div className="mt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">
              {t.whoCanSee}
            </h3>
            <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto">
              {circleMembers.map((m) => {
                const hasAccess = memberIdSet.has(m.id);
                return (
                  <li key={m.id} className="flex items-center justify-between gap-2 text-xs">
                    <UserLink userId={m.id} name={m.name} username={m.username} avatarUrl={m.avatarUrl} avatarSize={20} />
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() =>
                        startTransition(async () => {
                          if (hasAccess) await removeChannelMember(channel.id, m.id);
                          else await addChannelMember(channel.id, m.id);
                          router.refresh();
                        })
                      }
                      className="shrink-0 rounded-md border border-line px-2 py-1 font-medium hover:border-accent disabled:opacity-50"
                    >
                      {hasAccess ? t.removeAccess : t.grantAccess}
                    </button>
                  </li>
                );
              })}
              {circleMembers.length === 0 && (
                <li className="text-foreground-soft">{t.noMembers}</li>
              )}
            </ul>
          </div>
        )}

        <div className="mt-5 border-t border-line pt-4">
          {!confirmingDelete ? (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="text-xs font-medium text-danger hover:underline"
            >
              {t.delete}
            </button>
          ) : (
            <div className="flex items-center gap-2 text-xs">
              <span className="break-words text-foreground-soft">
                {deleteBefore}
                {channelName}
                {deleteAfter}
              </span>
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await deleteChannel(channel.id);
                    if (result.error) {
                      setError(byCode(t.errors, result.error));
                      setConfirmingDelete(false);
                      return;
                    }
                    setOpen(false);
                    router.push(`/circles/${circleSlug}`);
                    router.refresh();
                  })
                }
                className="rounded-md bg-danger px-2.5 py-1 font-medium text-white disabled:opacity-50"
              >
                {t.deleteAction}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-md border border-line px-2.5 py-1"
              >
                {t.cancel}
              </button>
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}
