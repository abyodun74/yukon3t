"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { updateChannel, deleteChannel, addChannelMember, removeChannelMember } from "@/app/actions/channels";
import { UserLink } from "@/components/user-link";
import { Sheet } from "@/components/sheet";

type CircleMember = { id: string; name: string | null; username: string | null; avatarUrl: string | null };

function errorMessage(code: string) {
  switch (code) {
    case "moderation":
      return "That name/topic didn't pass our content guidelines.";
    case "last_channel":
      return "Can't delete a Circle's only remaining channel.";
    case "rate_limited":
      return "Slow down a little — try again shortly.";
    default:
      return "Please check your inputs.";
  }
}

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

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await updateChannel(channel.id, formData);
      if (result.error) {
        setError(errorMessage(result.error));
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
        aria-label="Channel settings"
        className="rounded-lg p-1.5 text-foreground-soft hover:bg-line hover:text-accent"
      >
        <Settings size={16} />
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={<span className="break-words">#{channel.name} settings</span>}
        panelClassName="max-h-[85vh] overflow-y-auto"
      >
        <form action={handleSubmit} className="space-y-3 text-sm">
          <div>
            <label className="text-xs font-medium text-foreground-soft">Name</label>
            <input
              aria-label="Name"
              name="name"
              defaultValue={channel.name}
              required
              minLength={2}
              maxLength={50}
              className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground-soft">Topic</label>
            <input
              aria-label="Topic"
              name="topic"
              defaultValue={channel.topic ?? ""}
              maxLength={200}
              className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground-soft">Privacy</label>
            <div className="mt-1 flex gap-4">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="visibility" value="PUBLIC" defaultChecked={channel.visibility === "PUBLIC"} />{" "}
                Public
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="visibility" value="PRIVATE" defaultChecked={channel.visibility === "PRIVATE"} />{" "}
                Private
              </label>
            </div>
          </div>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50"
          >
            {isPending ? "Saving..." : "Save changes"}
          </button>
        </form>

        {channel.visibility === "PRIVATE" && (
          <div className="mt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-soft">
              Who can see this channel
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
                      {hasAccess ? "Remove" : "Grant access"}
                    </button>
                  </li>
                );
              })}
              {circleMembers.length === 0 && (
                <li className="text-foreground-soft">No other Circle members yet.</li>
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
              Delete this channel
            </button>
          ) : (
            <div className="flex items-center gap-2 text-xs">
              <span className="break-words text-foreground-soft">Delete #{channel.name} and its posts?</span>
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await deleteChannel(channel.id);
                    if (result.error) {
                      setError(errorMessage(result.error));
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
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-md border border-line px-2.5 py-1"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}
