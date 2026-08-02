"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveFlaggedContent, removeFlaggedContent } from "@/app/actions/reports";

export function FlaggedContentActions({
  contentType,
  contentId,
}: {
  contentType: "POST" | "COMMENT" | "MESSAGE";
  contentId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function run(action: (formData: FormData) => Promise<{ error: string | null }>) {
    const fd = new FormData();
    fd.set("contentType", contentType);
    fd.set("contentId", contentId);
    startTransition(async () => {
      await action(fd);
      router.refresh();
    });
  }

  return (
    <div className="mt-2 flex gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => run(approveFlaggedContent)}
        className="rounded-md border border-line px-2.5 py-1 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50"
      >
        Publish
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() => run(removeFlaggedContent)}
        className="rounded-md bg-danger px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        Remove
      </button>
    </div>
  );
}
