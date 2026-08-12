"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, X } from "lucide-react";
import { addGroupMembers } from "@/app/actions/messages";
import { MultiSelect } from "@/components/multi-select";

export function AddGroupMembersButton({
  conversationId,
  candidates,
}: {
  conversationId: string;
  candidates: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (candidates.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-foreground-soft hover:border-accent hover:text-accent"
      >
        <UserPlus size={13} />
        Add members
      </button>
    );
  }

  return (
    <div className="mt-3 w-full rounded-lg border border-line p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Add connections to this group</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Cancel"
          className="rounded-lg p-1 text-foreground-soft hover:bg-line"
        >
          <X size={14} />
        </button>
      </div>
      <form
        action={(fd) => {
          setError(null);
          startTransition(async () => {
            const result = await addGroupMembers(conversationId, fd);
            if (result.error) {
              setError("Couldn't add those members — try again.");
            } else {
              setOpen(false);
              router.refresh();
            }
          });
        }}
        className="mt-2"
      >
        <MultiSelect name="memberIds" options={candidates} placeholder="Search connections..." />
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
        <button
          type="submit"
          disabled={isPending}
          className="mt-2 w-full rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink disabled:opacity-50"
        >
          {isPending ? "Adding..." : "Add"}
        </button>
      </form>
    </div>
  );
}
