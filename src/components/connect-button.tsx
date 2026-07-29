"use client";

import { useState, useTransition } from "react";
import { requestConnection } from "@/app/actions/connections";

const intentLabels: Record<string, string> = {
  FRIENDSHIP: "Friendship",
  CULTURAL_EXCHANGE: "Cultural Exchange",
  PROFESSIONAL: "Professional",
  COMMUNITY: "Community",
  DATING: "Dating",
};

export function ConnectButton({
  targetId,
  openToIntents,
}: {
  targetId: string;
  openToIntents: string[];
}) {
  const [selected, setSelected] = useState(openToIntents[0] ?? "FRIENDSHIP");
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");
  const [isPending, startTransition] = useTransition();

  if (status === "sent") {
    return <p className="text-xs text-success">Request sent</p>;
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="rounded-md border border-line bg-surface px-2 py-1 text-xs"
      >
        {openToIntents.map((tag) => (
          <option key={tag} value={tag}>
            {intentLabels[tag] ?? tag}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          const fd = new FormData();
          fd.set("targetId", targetId);
          fd.set("intentTag", selected);
          startTransition(async () => {
            const result = await requestConnection(fd);
            setStatus(result.error ? "error" : "sent");
          });
        }}
        className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-ink disabled:opacity-50"
      >
        Connect
      </button>
      {status === "error" && (
        <span className="text-xs text-danger">Failed</span>
      )}
    </div>
  );
}
