"use client";

import { useState } from "react";
import { MultiSelect } from "@/components/multi-select";
import { useCollabText } from "@/components/collab-text";
import { COLLAB_CIRCLE_IDS_MAX } from "@/lib/collab-circle-invite";

/**
 * Public/private radio for creating a collab — Private reveals a connections picker and a picker of Circles you
 * created (each member gets their own invite) for who to invite up front.
 */
export function CollabVisibilityField({
  candidates,
  circleCandidates,
}: {
  candidates: { value: string; label: string }[];
  circleCandidates: { value: string; label: string }[];
}) {
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const { t: collab } = useCollabText();
  const t = collab.form;

  return (
    <div>
      <label className="block text-sm font-medium">{t.visibility}</label>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="visibility"
            value="PUBLIC"
            checked={visibility === "PUBLIC"}
            onChange={() => setVisibility("PUBLIC")}
          />
          {t.public}
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="visibility"
            value="PRIVATE"
            checked={visibility === "PRIVATE"}
            onChange={() => setVisibility("PRIVATE")}
          />
          {t.private}
        </label>
      </div>

      {visibility === "PRIVATE" && (
        <div className="mt-2 space-y-3">
          {candidates.length > 0 ? (
            <MultiSelect
              name="inviteeIds"
              options={candidates}
              placeholder={t.inviteePlaceholder}
              labels={collab.controls.multiSelect}
            />
          ) : (
            <p className="text-xs text-foreground-soft">
              {t.noConnections}
            </p>
          )}
          {circleCandidates.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-foreground-soft">{collab.invites.circleLabel}</label>
              <p className="mt-0.5 text-xs text-foreground-soft">{collab.invites.circleHint}</p>
              <div className="mt-1">
                <MultiSelect
                  name="circleIds"
                  options={circleCandidates}
                  placeholder={collab.invites.circlePlaceholder}
                  max={COLLAB_CIRCLE_IDS_MAX}
                  labels={collab.controls.multiSelect}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
