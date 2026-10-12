import type { z } from "zod";
import { MIN_AGE, signUpSchema } from "@/lib/validations";
import { isValidE164 } from "@/lib/phone-number";
import type { Dictionary } from "@/lib/i18n/en";
import { format } from "@/lib/i18n/locales";

// What signUpWithPassword hands back to the sign-up form when it can't create the account, and the rules for turning
// a failed submission into per-field reasons. Pure and client-safe: the action and the form both import it. The action
// only ever answers with reason codes; the form turns them into sentences from the dictionary of the page's language.

/** In the order the form shows them, which is also the order focus goes to the first one needing correction. */
export const SIGN_UP_FIELDS = ["username", "email", "password", "birthDate", "phone"] as const;
export type SignUpField = (typeof SIGN_UP_FIELDS)[number];

const { username: usernameRule, password: passwordRule } = signUpSchema.shape;

type SignUpFormStrings = Dictionary["signUp"]["form"];

export type SignUpReason = keyof SignUpFormStrings["reasons"];
export type SignUpFieldErrors = Partial<Record<SignUpField, SignUpReason>>;

/** Failures that aren't about any one field. */
export type SignUpFormError = keyof SignUpFormStrings["formErrors"];

export type SignUpState = { fieldErrors: SignUpFieldErrors; formError: SignUpFormError | null };

export const INITIAL_SIGN_UP_STATE: SignUpState = { fieldErrors: {}, formError: null };

/** The sentence for a reason, from `messages` (the `signUp.form.reasons` of whichever language the form is in). */
export function signUpReasonMessage(reason: SignUpReason, messages: SignUpFormStrings["reasons"]): string {
  return format(messages[reason], {
    usernameMin: usernameRule.minLength ?? "",
    usernameMax: usernameRule.maxLength ?? "",
    passwordMin: passwordRule.minLength ?? "",
    passwordMax: passwordRule.maxLength ?? "",
    age: MIN_AGE,
  });
}

export function signUpFormErrorMessage(error: SignUpFormError, messages: SignUpFormStrings["formErrors"]): string {
  return messages[error];
}

export type SignUpRaw = Record<SignUpField | "verificationMethod", unknown>;

function isSignUpField(value: unknown): value is SignUpField {
  return (SIGN_UP_FIELDS as readonly unknown[]).includes(value);
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function reasonFor(field: SignUpField, issueCodes: string[], raw: SignUpRaw): SignUpReason {
  switch (field) {
    case "username":
      if (!trimmed(raw.username)) return "username_required";
      if (issueCodes.includes("invalid_format")) return "username_characters";
      return issueCodes.includes("custom") ? "username_reserved" : "username_length";
    case "email":
      return trimmed(raw.email) ? "email_invalid" : "email_required";
    case "password":
      if (typeof raw.password !== "string" || raw.password === "") return "password_required";
      return issueCodes.includes("too_big") ? "password_too_long" : "password_too_short";
    case "birthDate":
      return issueCodes.includes("custom") ? "birth_date_underage" : "birth_date_required";
    case "phone":
      return trimmed(raw.phone) ? "phone_invalid" : "phone_required";
  }
}

/**
 * Validates a sign-up submission and names every field that fails, each with its specific reason (not just the
 * first failure). `data` is set only when nothing failed. `checkable` holds the normalized username / email / phone
 * that did pass, so the caller can still run the "already taken" lookups for them when another field failed.
 */
export function validateSignUp(raw: SignUpRaw): {
  data: z.output<typeof signUpSchema> | null;
  fieldErrors: SignUpFieldErrors;
  formError: SignUpFormError | null;
  checkable: { username: string | null; email: string | null; phone: string | null };
} {
  const parsed = signUpSchema.safeParse(raw);
  const fieldErrors: SignUpFieldErrors = {};
  let formError: SignUpFormError | null = null;

  if (!parsed.success) {
    const codesByField = new Map<SignUpField, string[]>();
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      // Anything else (a verification method the form doesn't offer) is not something the person can correct.
      if (!isSignUpField(field)) formError = "invalid";
      else codesByField.set(field, [...(codesByField.get(field) ?? []), issue.code]);
    }
    for (const [field, codes] of codesByField) fieldErrors[field] = reasonFor(field, codes, raw);
  }

  // z.coerce.date() reads a missing value as 1970-01-01, which would pass the age check.
  if (!trimmed(raw.birthDate)) fieldErrors.birthDate = "birth_date_required";

  // The schema's own phone check is skipped whenever another field fails, and only checks the E.164 shape.
  const byPhone = raw.verificationMethod === "PHONE";
  if (byPhone && !fieldErrors.phone && !isValidE164(trimmed(raw.phone))) {
    fieldErrors.phone = reasonFor("phone", [], raw);
  }

  const shape = signUpSchema.shape;
  const ok = parsed.success && !formError && Object.keys(fieldErrors).length === 0;
  return {
    data: ok ? parsed.data : null,
    fieldErrors,
    formError,
    checkable: {
      username: fieldErrors.username ? null : (shape.username.safeParse(raw.username).data ?? null),
      email: fieldErrors.email ? null : (shape.email.safeParse(raw.email).data ?? null),
      phone: byPhone && !fieldErrors.phone ? trimmed(raw.phone) : null,
    },
  };
}

/** Adds an "already taken" reason for each field the lookups found in use. */
export function withTakenErrors(
  fieldErrors: SignUpFieldErrors,
  taken: { username?: boolean; email?: boolean; phone?: boolean },
): SignUpFieldErrors {
  return {
    ...fieldErrors,
    ...(taken.username ? { username: "username_taken" as const } : {}),
    ...(taken.email ? { email: "email_taken" as const } : {}),
    ...(taken.phone ? { phone: "phone_taken" as const } : {}),
  };
}

/**
 * Which fields the form shows: after a failed submit only the ones that need correcting (the rest stay in the form,
 * hidden, and are submitted again as they are); every field when nothing field-specific failed or the person asked
 * to edit all their details.
 */
export function signUpFieldsToShow(fieldErrors: SignUpFieldErrors, editAll: boolean): SignUpField[] {
  const failing = SIGN_UP_FIELDS.filter((field) => fieldErrors[field]);
  return editAll || failing.length === 0 ? [...SIGN_UP_FIELDS] : failing;
}
