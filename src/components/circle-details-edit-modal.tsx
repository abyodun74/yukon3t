"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X } from "lucide-react";
import { updateCircleDetails } from "@/app/actions/circles";
import { MultiSelect } from "@/components/multi-select";

const PRIVACY_OPTIONS = [
  ["PUBLIC", "Public", "Anyone can find and join it, and its posts and live streams can appear on Home and in search."],
  ["PRIVATE", "Private", "People request to join. Its posts and live streams are visible only to members and never appear on Home or in search."],
] as const;

function errorMessage(code: string) {
  switch (code) {
    case "moderation":
      return "That name or theme didn't pass our content guidelines.";
    case "rate_limited":
      return "Slow down a little — try again shortly.";
    case "forbidden":
      return "Only the owner or a co-admin can edit this Circle.";
    default:
      return "Please check your input.";
  }
}

/** Owner/co-admin-only — mirrors ChannelSettingsModal's edit-in-a-modal pattern, for a Circle's name, theme, categories and privacy. The slug (and so its URL) never changes. */
export function CircleDetailsEditModal({
  circleId,
  name,
  description,
  category,
  categoryOptions,
  visibility,
  visibilityLocked,
  hasSubCircles,
}: {
  circleId: string;
  name: string;
  /** The Circle's theme — the `description` column, which the creation wizard labels "Theme". */
  description: string;
  category: string[];
  categoryOptions: readonly string[];
  visibility: "PUBLIC" | "PRIVATE";
  /** A sub-circle under a private main Circle stays private — it can't be more open than its parent. */
  visibilityLocked: boolean;
  /** A main Circle going private also takes its sub-circles private. */
  hasSubCircles: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState<"PUBLIC" | "PRIVATE">(visibility);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Edit Circle details"
        className="shrink-0 rounded-lg p-1.5 text-foreground-soft hover:bg-line hover:text-accent"
      >
        <Pencil size={16} />
      </button>
    );
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await updateCircleDetails(circleId, formData);
      if (result.error) {
        setError(errorMessage(result.error));
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="animate-modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="animate-modal-panel-in max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-xl bg-surface p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Edit Circle</h2>
          <button type="button" onClick={() => setOpen(false)} className="shrink-0 text-foreground-soft">
            <X size={16} />
          </button>
        </div>

        <form action={handleSubmit} className="mt-3 space-y-3 text-sm">
          <div>
            <label className="text-xs font-medium text-foreground-soft">Name</label>
            <input
              name="name"
              defaultValue={name}
              required
              minLength={3}
              maxLength={60}
              autoFocus
              className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 outline-none focus:border-accent"
            />
          </div>
          <div>
            <label htmlFor="circle-edit-theme" className="text-xs font-medium text-foreground-soft">
              Theme
            </label>
            <p className="mt-0.5 text-[11px] text-foreground-soft">
              What this Circle is about, so people know what to expect before they join.
            </p>
            <textarea
              id="circle-edit-theme"
              name="description"
              defaultValue={description}
              required
              minLength={10}
              maxLength={1000}
              rows={4}
              className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground-soft">Category</label>
            <div className="mt-1">
              <MultiSelect
                name="category"
                options={categoryOptions}
                defaultValues={category}
                placeholder="Search categories..."
                max={5}
              />
            </div>
          </div>
          <fieldset>
            <legend className="text-xs font-medium text-foreground-soft">Privacy</legend>
            {visibilityLocked ? (
              <>
                <input type="hidden" name="visibility" value="PRIVATE" />
                <p className="mt-1 text-[11px] text-foreground-soft">
                  Private — a sub-circle under a private Circle stays private.
                </p>
              </>
            ) : (
              <div className="mt-1 space-y-1.5">
                {PRIVACY_OPTIONS.map(([value, label, help]) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-start gap-2 rounded-lg border border-line p-2 has-[:checked]:border-accent"
                  >
                    <input
                      type="radio"
                      name="visibility"
                      value={value}
                      checked={privacy === value}
                      onChange={() => setPrivacy(value)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{label}</span>
                      <span className="block text-[11px] text-foreground-soft">{help}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {privacy === "PRIVATE" && visibility === "PUBLIC" && !visibilityLocked && (
              <p className="mt-1.5 text-[11px] text-danger">
                Making this Circle private hides its existing posts and live streams from non-members right away
                {hasSubCircles ? ", and makes its sub-circles private too" : ""}. Anyone who is already a member stays a member.
              </p>
            )}
          </fieldset>
          {error && <p className="text-xs text-danger">{error}</p>}
          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50"
          >
            {isPending ? "Saving..." : "Save changes"}
          </button>
        </form>
      </div>
    </div>
  );
}
