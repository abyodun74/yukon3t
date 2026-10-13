"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { updateCircleDetails } from "@/app/actions/circles";
import { MultiSelect } from "@/components/multi-select";
import { Sheet } from "@/components/sheet";
import { useCirclesText } from "@/components/circles-text";
import { byCode } from "@/lib/i18n/locales";

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
  /** `value` is the stored (English) category, `label` what it is shown as in the reader's language. */
  categoryOptions: readonly { value: string; label: string }[];
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
  const { t: circles } = useCirclesText();
  const t = circles.details;
  const privacyOptions = [
    ["PUBLIC", t.public, t.publicHelp],
    ["PRIVATE", t.private, t.privateHelp],
  ] as const;

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await updateCircleDetails(circleId, formData);
      if (result.error) {
        setError(byCode(t.errors, result.error));
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t.open}
        className="shrink-0 rounded-lg p-1.5 text-foreground-soft hover:bg-line hover:text-accent"
      >
        <Pencil size={16} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t.title} panelClassName="max-h-[85vh] overflow-y-auto">
        <form action={handleSubmit} className="space-y-3 text-sm">
          <div>
            <label className="text-xs font-medium text-foreground-soft">{t.name}</label>
            <input
              aria-label={t.name}
              name="name"
              dir="auto"
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
              {t.theme}
            </label>
            <p className="mt-0.5 text-[0.6875rem] text-foreground-soft">{t.themeHint}</p>
            <textarea
              id="circle-edit-theme"
              name="description"
              dir="auto"
              defaultValue={description}
              required
              minLength={10}
              maxLength={1000}
              rows={4}
              className="mt-1 w-full rounded-lg border border-line bg-transparent px-3 py-2 outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground-soft">{t.category}</label>
            <div className="mt-1">
              <MultiSelect
                name="category"
                options={categoryOptions}
                defaultValues={category}
                placeholder={t.categoryPlaceholder}
                max={5}
                labels={circles.controls.multiSelect}
              />
            </div>
          </div>
          <fieldset>
            <legend className="text-xs font-medium text-foreground-soft">{t.privacy}</legend>
            {visibilityLocked ? (
              <>
                <input type="hidden" name="visibility" value="PRIVATE" />
                <p className="mt-1 text-[0.6875rem] text-foreground-soft">
                  {t.lockedPrivate}
                </p>
              </>
            ) : (
              <div className="mt-1 space-y-1.5">
                {privacyOptions.map(([value, label, help]) => (
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
                      <span className="block text-[0.6875rem] text-foreground-soft">{help}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {privacy === "PRIVATE" && visibility === "PUBLIC" && !visibilityLocked && (
              <p className="mt-1.5 text-[0.6875rem] text-danger">
                {hasSubCircles ? t.goingPrivateSubs : t.goingPrivate}
              </p>
            )}
          </fieldset>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50"
          >
            {isPending ? t.saving : t.save}
          </button>
        </form>
      </Sheet>
    </>
  );
}
