"use client";

import { useRef, useState } from "react";
import { createCircle } from "@/app/actions/circles";
import { MultiSelect } from "@/components/multi-select";
import { cn } from "@/lib/utils";

const STEP_LABELS = ["Name", "Category", "Theme", "Privacy"] as const;

function validateStep(step: number, formData: FormData): string | null {
  if (step === 1) {
    const name = ((formData.get("name") as string) ?? "").trim();
    if (name.length < 3 || name.length > 60) {
      return "Name must be between 3 and 60 characters.";
    }
  }
  if (step === 2) {
    const category = formData.getAll("category") as string[];
    if (category.length < 1) return "Pick at least one category.";
    if (category.length > 5) return "Pick at most 5 categories.";
  }
  if (step === 3) {
    const description = ((formData.get("description") as string) ?? "").trim();
    if (description.length < 10 || description.length > 1000) {
      return "Theme must be between 10 and 1000 characters.";
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
  categories: readonly string[];
  /** Set when creating a sub-circle under this main Circle (see createCircle). */
  parentId?: string;
  parentName?: string;
  /** The main Circle is PRIVATE, so this sub-circle must be too — see subCircleVisibility. */
  forcePrivate?: boolean;
}) {
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function goNext() {
    if (!formRef.current) return;
    const message = validateStep(step, new FormData(formRef.current));
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
        {STEP_LABELS.map((label, i) => {
          const stepNumber = i + 1;
          return (
            <li key={label} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]",
                  step === stepNumber
                    ? "border-accent bg-accent-soft text-accent"
                    : step > stepNumber
                      ? "border-teal text-teal"
                      : "border-line",
                )}
              >
                {stepNumber}
              </span>
              <span className={cn(step === stepNumber && "text-foreground")}>{label}</span>
              {stepNumber < STEP_LABELS.length && <span className="ml-1 text-line">/</span>}
            </li>
          );
        })}
      </ol>

      <div className={step === 1 ? "" : "hidden"}>
        <label className="block text-sm font-medium">Name</label>
        <input
          name="name"
          required
          minLength={3}
          maxLength={60}
          className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
        />
      </div>

      <div className={step === 2 ? "" : "hidden"}>
        <label className="block text-sm font-medium">Category</label>
        <p className="mt-0.5 text-xs text-foreground-soft">
          General topics plus specific job types — search e.g. &quot;Cybersecurity Analyst&quot; or &quot;Bookkeeping&quot;.
        </p>
        <div className="mt-1">
          <MultiSelect
            name="category"
            options={categories}
            placeholder="Search categories..."
            max={5}
          />
        </div>
      </div>

      <div className={step === 3 ? "" : "hidden"}>
        <label className="block text-sm font-medium">Theme</label>
        <p className="mt-0.5 text-xs text-foreground-soft">
          Describe what this Circle is about — the shared interest or
          identity that brings people here — so members know what to
          expect before they join.
        </p>
        <textarea
          name="description"
          required
          minLength={10}
          maxLength={1000}
          rows={4}
          placeholder="e.g. A space for first-gen university students abroad to swap advice on visas, housing, and homesickness."
          className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
        />
      </div>

      <div className={step === 4 ? "" : "hidden"}>
        <label className="block text-sm font-medium">Privacy</label>
        {forcePrivate ? (
          <>
            <input type="hidden" name="visibility" value="PRIVATE" />
            <p className="mt-1 text-sm text-foreground-soft">
              Private — join by request only. {parentName ? `“${parentName}”` : "The main Circle"} is private, so its
              sub-circles are too.
            </p>
          </>
        ) : (
          <div className="mt-1 flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="visibility" value="PUBLIC" defaultChecked />
              Public — anyone can find and join
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="visibility" value="PRIVATE" />
              Private — join by request only
            </label>
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">{error}</p>
      )}

      <div className="flex items-center gap-2 pt-2">
        {step > 1 && (
          <button
            type="button"
            onClick={goBack}
            className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium hover:border-accent"
          >
            Back
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
            className="ml-auto rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink"
          >
            Next
          </button>
        ) : (
          <button
            key="create"
            type="submit"
            className="ml-auto rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
          >
            {parentId ? "Create sub-circle" : "Create Circle"}
          </button>
        )}
      </div>
    </form>
  );
}
