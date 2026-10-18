"use client";

import { createContext, useContext } from "react";
import type { CollabFormField } from "@/lib/collab-form-errors";
import { useCollabText } from "@/components/collab-text";

const EMPTY: ReadonlySet<CollabFormField> = new Set();

/** Which inputs of the create form are flagged. Outside CollabCreateForm (the edit form) none is, so the shared fields render as before. */
const CollabFormErrorsContext = createContext<ReadonlySet<CollabFormField>>(EMPTY);
export const CollabFormErrorsProvider = CollabFormErrorsContext.Provider;

export function useCollabFieldInvalid(field: CollabFormField): boolean {
  return useContext(CollabFormErrorsContext).has(field);
}

export function collabFieldErrorId(field: CollabFormField): string {
  return `collab-error-${field}`;
}

/** The message under a failed input; renders nothing while the field is fine. */
export function CollabFieldError({ field }: { field: CollabFormField }) {
  const invalid = useCollabFieldInvalid(field);
  const { t } = useCollabText();
  if (!invalid) return null;
  return (
    <p id={collabFieldErrorId(field)} className="mt-1 text-xs text-danger">
      {t.form.fieldErrors[field]}
    </p>
  );
}

/** Attributes that mark an input as failed and tie it to its message. */
export function collabInvalidProps(invalid: boolean, field: CollabFormField) {
  return invalid ? ({ "aria-invalid": true, "aria-describedby": collabFieldErrorId(field) } as const) : {};
}
