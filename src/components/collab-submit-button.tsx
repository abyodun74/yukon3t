"use client";

import { useFormStatus } from "react-dom";

/**
 * Disables itself the instant the form's server action starts (useFormStatus
 * flips synchronously on submit) so a double-click/double-tap can't fire
 * createCollabPost twice before the redirect navigates away — that race was
 * producing duplicate collaboration posts.
 */
export function CollabSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink disabled:opacity-50"
    >
      {pending ? "Posting..." : "Post"}
    </button>
  );
}
