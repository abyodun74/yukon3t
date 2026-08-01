"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { renameGroupChat } from "@/app/actions/messages";

export function GroupNameEditor({
  conversationId,
  name,
  canEdit,
}: {
  conversationId: string;
  name: string;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function save() {
    const trimmed = draft.trim();
    if (!trimmed || isPending) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("name", trimmed);
      const result = await renameGroupChat(conversationId, fd);
      if (result.error) {
        setError(
          result.error === "moderation" ? "That name didn't pass our content guidelines." : "Couldn't save that name.",
        );
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function cancel() {
    setEditing(false);
    setDraft(name);
    setError(null);
  }

  if (!canEdit) {
    return <h1 className="text-lg font-semibold">{name}</h1>;
  }

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="flex min-w-0 items-center gap-1.5">
        <h1 className="truncate text-lg font-semibold">{name}</h1>
        <Pencil size={13} className="shrink-0 text-foreground-soft" />
      </button>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              cancel();
            }
          }}
          maxLength={60}
          autoFocus
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-base font-semibold outline-none focus:border-accent"
        />
        <button
          type="button"
          disabled={isPending || !draft.trim()}
          onClick={save}
          className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-ink disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={cancel}
          className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
