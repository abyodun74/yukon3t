"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { createChannel } from "@/app/actions/channels";

function errorMessage(code: string) {
  switch (code) {
    case "moderation":
      return "That name/topic didn't pass our content guidelines.";
    case "rate_limited":
      return "Slow down a little — try again shortly.";
    default:
      return "Please check your inputs.";
  }
}

export function CreateChannelModal({ circleId }: { circleId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-foreground-soft hover:bg-line hover:text-accent"
      >
        <Plus size={14} /> Add channel
      </button>
    );
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createChannel(circleId, formData);
      if (result.error) {
        setError(errorMessage(result.error));
        return;
      }
      setOpen(false);
      formRef.current?.reset();
      router.refresh();
    });
  }

  return (
    <div className="animate-modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="animate-modal-panel-in w-full max-w-sm rounded-xl bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">New channel</h2>
          <button type="button" onClick={() => setOpen(false)} className="text-foreground-soft">
            <X size={16} />
          </button>
        </div>
        <form ref={formRef} action={handleSubmit} className="mt-3 space-y-3 text-sm">
          <div>
            <label className="text-xs font-medium text-foreground-soft">Name</label>
            <input
              name="name"
              required
              minLength={2}
              maxLength={50}
              className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground-soft">Type</label>
            <div className="mt-1 flex gap-4">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="type" value="TEXT" defaultChecked /> Text
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="type" value="VOICE" /> Voice
              </label>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-foreground-soft">
              Topic — what&apos;s this channel for?
            </label>
            <input
              name="topic"
              maxLength={200}
              placeholder="e.g. Weekly study check-ins"
              className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground-soft">Privacy</label>
            <div className="mt-1 flex gap-4">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="visibility" value="PUBLIC" defaultChecked /> Public
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="visibility" value="PRIVATE" /> Private
              </label>
            </div>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50"
          >
            {isPending ? "Creating..." : "Create channel"}
          </button>
        </form>
      </div>
    </div>
  );
}
