"use client";

import { useState, useTransition } from "react";
import { approveFlaggedContent, removeFlaggedContent } from "@/app/actions/reports";

export function FlaggedContentActions({
  contentType,
  contentId,
}: {
  contentType: "POST" | "COMMENT" | "MESSAGE" | "MUSE";
  contentId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // No router.refresh() after the action: both actions call
  // revalidatePath("/admin/moderation"), and a Server Action that does so
  // gets this page re-rendered in its own response (Next's single-roundtrip
  // model). A refresh on top rendered the whole queue a second time per
  // click.
  function run(action: (formData: FormData) => Promise<{ error: string | null }>) {
    const fd = new FormData();
    fd.set("contentType", contentType);
    fd.set("contentId", contentId);
    startTransition(async () => {
      setError(null);
      try {
        const result = await action(fd);
        if (result.error === "not_found") {
          setError("This was already removed.");
        } else if (result.error) {
          setError("Couldn't do that. Try again.");
        }
      } catch {
        // A thrown action (a timeout, a dropped connection, a row someone
        // else just deleted) may or may not have gone through.
        setError("That didn't finish. Reload the page to check, then try again.");
      }
    });
  }

  return (
    <div className="mt-2">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(approveFlaggedContent)}
          className="rounded-md border border-line px-2.5 py-2 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50"
        >
          Publish
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(removeFlaggedContent)}
          className="rounded-md bg-danger px-2.5 py-2 text-xs font-medium text-white disabled:opacity-50"
        >
          Remove
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
