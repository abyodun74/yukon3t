"use client";

import { useRef, useState } from "react";
import { createCircle } from "@/app/actions/circles";
import { MultiSelect } from "@/components/multi-select";
import { useCirclesText } from "@/components/circles-text";
import type { circlesEn } from "@/lib/i18n/en/circles";
import { format } from "@/lib/i18n/locales";
import { cn } from "@/lib/utils";

const STEPS = ["name", "category", "theme", "privacy"] as const;

function validateStep(
  step: number,
  formData: FormData,
  messages: typeof circlesEn.create.validation,
): string | null {
  if (step === 1) {
    const name = ((formData.get("name") as string) ?? "").trim();
    if (name.length < 3 || name.length > 60) {
      return messages.name;
    }
  }
  if (step === 2) {
    const category = formData.getAll("category") as string[];
    if (category.length < 1) return messages.categoryMin;
    if (category.length > 5) return messages.categoryMax;
  }
  if (step === 3) {
    const description = ((formData.get("description") as string) ?? "").trim();
    if (description.length < 10 || description.length > 1000) {
      return messages.theme;
    }
  }
  return null;
}

/**
 * 4-step wizard (Name → Category → Theme → Privacy) around the same fields
 * `createCircle` has always accepted. Every step's inputs stay mounted the
 * whole time (just hidden via CSS when not active), so nothing loses its
 * value on Back — including MultiSelect's own internal selection state.
 */
export function NewCircleWizard({
  categories,
  parentId,
  parentName,
  forcePrivate = false,
}: {
  /** `value` is the stored (English) category, `label` what it is shown as in the reader's language. */
  categories: readonly { value: string; label: string }[];
  /** Set when creating a sub-circle under this main Circle (see createCircle). */
  parentId?: string;
  parentName?: string;
  /** The main Circle is PRIVATE, so this sub-circle must be too — see subCircleVisibility. */
  forcePrivate?: boolean;
}) {
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { t: circles } = useCirclesText();
  const t = circles.create;

  function goNext() {
    if (!formRef.current) return;
    const message = validateStep(step, new FormData(formRef.current), t.validation);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    setStep((s) => Math.min(4, s + 1));
  }

  function goBack() {
    setError(null);
    setStep((s) => Math.max(1, s - 1));
  }

  return (
    <form ref={formRef} action={createCircle} className="mt-6 space-y-4">
      {parentId && <input type="hidden" name="parentId" value={parentId} />}
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-foreground-soft">
        {STEPS.map((key, i) => {
          const stepNumber = i + 1;
          return (
            <li key={key} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[0.625rem]",
                  step === stepNumber
                    ? "border-accent bg-accent-soft text-accent"
                    : step > stepNumber
                      ? "border-teal text-teal"
                      : "border-line",
                )}
              >
                {stepNumber}
              </span>
              <span className={cn(step === stepNumber && "text-foreground")}>{t.steps[key]}</span>
              {stepNumber < STEPS.length && <span className="ms-1 text-line">/</span>}
            </li>
          );
        })}
      </ol>

      <div className={step === 1 ? "" : "hidden"}>
        <label className="block text-sm font-medium">{t.name}</label>
        <input
          aria-label={t.name}
          name="name"
          dir="auto"
          required
          minLength={3}
          maxLength={60}
          className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
        />
      </div>

      <div className={step === 2 ? "" : "hidden"}>
        <label className="block text-sm font-medium">{t.category}</label>
        <p className="mt-0.5 text-xs text-foreground-soft">{t.categoryHint}</p>
        <div className="mt-1">
          <MultiSelect
            name="category"
            options={categories}
            placeholder={t.categoryPlaceholder}
            max={5}
            labels={circles.controls.multiSelect}
          />
        </div>
      </div>

      <div className={step === 3 ? "" : "hidden"}>
        <label className="block text-sm font-medium">{t.theme}</label>
        <p className="mt-0.5 text-xs text-foreground-soft">{t.themeHint}</p>
        <textarea
          aria-label={t.theme}
          name="description"
          dir="auto"
          required
          minLength={10}
          maxLength={1000}
          rows={4}
          placeholder={t.themePlaceholder}
          className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
        />
      </div>

      <div className={step === 4 ? "" : "hidden"}>
        <label className="block text-sm font-medium">{t.privacy}</label>
        {forcePrivate ? (
          <>
            <input type="hidden" name="visibility" value="PRIVATE" />
            <p className="mt-1 text-sm text-foreground-soft">
              {parentName ? format(t.forcedPrivate, { name: parentName }) : t.forcedPrivateNoName}
            </p>
          </>
        ) : (
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="visibility" value="PUBLIC" defaultChecked />
              {t.public}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="visibility" value="PRIVATE" />
              {t.private}
            </label>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">{error}</p>
      )}

      <div className="flex items-center gap-2 pt-2">
        {step > 1 && (
          <button
            type="button"
            onClick={goBack}
            className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium hover:border-accent"
          >
            {t.back}
          </button>
        )}
        {/* The `key`s are load-bearing. Without them React sees one <button> in
            the same spot and just flips its `type` from "button" to "submit"
            when step 3's "Next" is clicked — and since that re-render lands
            before the browser runs the click's default action, the browser
            treats the very same click as a submit. Net effect: tapping Next
            on the Theme step created the Circle on the spot (always PUBLIC,
            whatever was meant), and the Privacy step was never shown. Distinct
            keys make React replace the element instead, so the original
            "button" is already gone by the time the click resolves. */}
        {step < 4 ? (
          <button
            key="next"
            type="button"
            onClick={goNext}
            className="ms-auto rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink"
          >
            {t.next}
          </button>
        ) : (
          <button
            key="create"
            type="submit"
            className="ms-auto rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
          >
            {parentId ? t.submitSub : t.submit}
          </button>
        )}
      </div>
    </form>
  );
}
