"use client";

import { useState } from "react";
import { MultiSelect } from "@/components/multi-select";

/** Public/private radio for creating a collab — Private reveals a connections picker for who to invite up front. */
export function CollabVisibilityField({
  candidates,
}: {
  candidates: { value: string; label: string }[];
}) {
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");

  return (
    <div>
      <label className="block text-sm font-medium">Who can see this?</label>
      <div className="mt-1 flex gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="visibility"
            value="PUBLIC"
            checked={visibility === "PUBLIC"}
            onChange={() => setVisibility("PUBLIC")}
          />
          Public — announced to everyone, request to join
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="visibility"
            value="PRIVATE"
            checked={visibility === "PRIVATE"}
            onChange={() => setVisibility("PRIVATE")}
          />
          Private — invite specific people
        </label>
      </div>

      {visibility === "PRIVATE" && (
        <div className="mt-2">
          {candidates.length > 0 ? (
            <MultiSelect name="inviteeIds" options={candidates} placeholder="Search connections to invite..." />
          ) : (
            <p className="text-xs text-foreground-soft">
              You don&apos;t have any connections yet to invite — connect with someone first.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
