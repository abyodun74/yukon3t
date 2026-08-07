"use client";

import { useRef, useState, useTransition } from "react";
import { createAnnouncement } from "@/app/actions/announcements";

export function CreateAnnouncementForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createAnnouncement(formData);
      if (result.error) {
        setError("Please fill in a title (3+ chars) and body (10+ chars).");
        return;
      }
      formRef.current?.reset();
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="space-y-3 rounded-xl border border-line p-4">
      <div>
        <label htmlFor="title" className="text-xs font-medium text-foreground-soft">
          Title
        </label>
        <input
          id="title"
          name="title"
          type="text"
          maxLength={120}
          required
          className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>
      <div>
        <label htmlFor="body" className="text-xs font-medium text-foreground-soft">
          What&apos;s new
        </label>
        <textarea
          id="body"
          name="body"
          rows={4}
          maxLength={4000}
          required
          className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
      >
        {isPending ? "Posting..." : "Post announcement"}
      </button>
    </form>
  );
}
