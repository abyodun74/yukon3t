"use client";

import { useState } from "react";
import { Users, X } from "lucide-react";
import { UserLink } from "@/components/user-link";

type Member = {
  userId: string;
  name: string | null;
  username?: string | null;
  avatarUrl?: string | null;
};

/**
 * Read-only member list for a group chat, visible to every member — not
 * just the creator (who separately gets AddGroupMembersButton for actually
 * managing membership). Same collapsed-button-then-panel shape as that
 * component, just with nothing to submit.
 */
export function GroupMembersButton({ members }: { members: Member[] }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-foreground-soft transition-transform hover:border-accent hover:text-accent active:scale-95"
      >
        <Users size={13} />
        {members.length} {members.length === 1 ? "member" : "members"}
      </button>
    );
  }

  return (
    <div className="mt-3 w-full rounded-lg border border-line p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Members</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="rounded-lg p-1 text-foreground-soft hover:bg-line"
        >
          <X size={14} />
        </button>
      </div>
      <ul className="mt-2 divide-y divide-line">
        {members.map((m) => (
          <li key={m.userId} className="py-2 text-sm">
            <UserLink userId={m.userId} name={m.name} username={m.username} avatarUrl={m.avatarUrl} />
          </li>
        ))}
      </ul>
    </div>
  );
}
