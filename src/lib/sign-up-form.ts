import type { z } from "zod";
import { MIN_AGE, signUpSchema } from "@/lib/validations";
import { isValidE164, PHONE_INVALID_MESSAGE } from "@/lib/phone-number";

// What signUpWithPassword hands back to the sign-up form when it can't create the account, and the rules for turning
// a failed submission into per-field reasons. Pure and client-safe: the action and the form both import it.

/** In the order the form shows them, which is also the order focus goes to the first one needing correction. */
export const SIGN_UP_FIELDS = ["username", "email", "password", "birthDate", "phone"] as const;
export type SignUpField = (typeof SIGN_UP_FIELDS)[number];

const { username: usernameRule, password: passwordRule } = signUpSchema.shape;

const REASON_MESSAGES = {
  username_required: "Choose a username.",
  username_length: `Usernames are ${usernameRule.minLength}–${usernameRule.maxLength} characters long.`,
  username_characters: `Usernames can only use letters, numbers and underscores (${usernameRule.minLength}–${usernameRule.maxLength} characters).`,
  username_reserved: "That username is reserved — choose a different one.",
  username_taken: "That username is taken — try another.",
  email_required: "Enter your email address.",
  email_invalid: "That doesn't look like a valid email address — check it for typos.",
  email_taken: "An account with that email already exists.",
  password_required: "Choose a password.",
  password_too_short: `Passwords need at least ${passwordRule.minLength} characters.`,
  password_too_long: `Passwords can be at most ${passwordRule.maxLength} characters.`,
  birth_date_required: "Select the month, day and year you were born.",
  birth_date_underage: `You must be at least ${MIN_AGE} years old to use YuKon3t.`,
  phone_required: "Enter your phone number.",
  phone_invalid: PHONE_INVALID_MESSAGE,
  phone_taken: "That phone number is already verified on another account.",
} as const;

export type SignUpReason = keyof typeof REASON_MESSAGES;
export type SignUpFieldErrors = Partial<Record<SignUpField, SignUpReason>>;

const FORM_ERROR_MESSAGES = {
  rate_limited: "Too many attempts. Please wait a bit and try again.",
  captcha:
    "We couldn't complete the security check. Wait a moment and try again — if it keeps happening, turn off any content blocker or try another network.",
  invalid: "Something went wrong — please try again.",
} as const;

/** Failures that aren't about any one field. */
export type SignUpFormError = keyof typeof FORM_ERROR_MESSAGES;

export type SignUpState = { fieldErrors: SignUpFieldErrors; formError: SignUpFormError | null };

export const INITIAL_SIGN_UP_STATE: SignUpState = { fieldErrors: {}, formError: null };

export function signUpReasonMessage(reason: SignUpReason): string {
  return REASON_MESSAGES[reason];
}

export function signUpFormErrorMessage(error: SignUpFormError): string {
  return FORM_ERROR_MESSAGES[error];
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
