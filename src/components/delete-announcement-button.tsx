"use client";

import { useTransition } from "react";
import { deleteAnnouncement } from "@/app/actions/announcements";

export function DeleteAnnouncementButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => startTransition(async () => { await deleteAnnouncement(id); })}
      className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-danger hover:border-danger disabled:opacity-50"
    >
      Delete
    </button>
  );
}
