"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X } from "lucide-react";
import { updateCircleName } from "@/app/actions/circles";

function errorMessage(code: string) {
  switch (code) {
    case "moderation":
      return "That name didn't pass our content guidelines.";
    case "rate_limited":
      return "Slow down a little — try again shortly.";
    case "forbidden":
      return "Only the owner or a co-admin can rename this Circle.";
    default:
      return "Please check your input.";
  }
}

/** Owner/co-admin-only — mirrors ChannelSettingsModal's edit-in-a-modal pattern, scoped to just the Circle's name. The slug (and so its URL) never changes. */
export function CircleNameEditModal({ circleId, name }: { circleId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Edit Circle name"
        className="shrink-0 rounded-lg p-1.5 text-foreground-soft hover:bg-line hover:text-accent"
      >
        <Pencil size={16} />
      </button>
    );
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await updateCircleName(circleId, formData);
      if (result.error) {
        setError(errorMessage(result.error));
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl bg-surface p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Rename Circle</h2>
          <button type="button" onClick={() => setOpen(false)} className="shrink-0 text-foreground-soft">
            <X size={16} />
          </button>
        </div>

        <form action={handleSubmit} className="mt-3 space-y-3 text-sm">
          <div>
            <label className="text-xs font-medium text-foreground-soft">Name</label>
            <input
              name="name"
              defaultValue={name}
              required
              minLength={3}
              maxLength={60}
              autoFocus
              className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 outline-none focus:border-accent"
            />
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50"
          >
            {isPending ? "Saving..." : "Save changes"}
          </button>
        </form>
      </div>
    </div>
  );
}
