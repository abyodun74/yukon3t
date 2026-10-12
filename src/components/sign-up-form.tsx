"use client";

import { startTransition, useActionState, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { signUpWithPassword } from "@/app/actions/password-auth";
import { PasswordInput } from "@/components/password-input";
import { SubmitButton } from "@/components/submit-button";
import { BirthDateSelect } from "@/components/birth-date-select";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { VerifyMethodFields } from "@/components/verify-method-fields";
import { MIN_AGE } from "@/lib/validations";
import { cn } from "@/lib/utils";
import {
  INITIAL_SIGN_UP_STATE,
  SIGN_UP_FIELDS,
  signUpFieldsToShow,
  signUpFormErrorMessage,
  signUpReasonMessage,
  type SignUpField,
  type SignUpState,
} from "@/lib/sign-up-form";

const INPUT_CLASS = "w-full rounded-lg border border-line bg-surface px-4 py-3 text-sm outline-none focus:border-accent";

// Where focus goes for each field after a failed submit.
const FIELD_INPUT_ID: Record<SignUpField, string> = {
  username: "signup-username",
  email: "signup-email",
  password: "signup-password",
  birthDate: "signup-birth-month",
  phone: "signup-phone",
};

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1 text-xs text-danger">
      {children}
    </p>
  );
}

/**
 * The password sign-up form. signUpWithPassword answers a failed submit with a SignUpState instead of redirecting, and
 * this then shows only the fields that need correcting, each with its reason underneath. Every field stays mounted
 * the whole time — the ones that were fine are merely hidden — so nothing typed (password and birth date included) is
 * lost and a resubmit sends all of it again.
 *
 * - The action is called from onSubmit, not left to `<form action>`: React resets a form after its action runs, and
 *   that reset blanks controlled <select>s (the birth date, the phone country). `action` is still set so a tap
 *   before hydration is replayed as a POST rather than becoming a GET with the password in the URL.
 * - `botProtection` is <BotProtectionFields /> rendered by the server page and passed in. Rendered here it would
 *   re-stamp its timestamp on every client re-render and trip the minimum-fill-time check on a quick resubmit.
 * - TurnstileWidget fetches a fresh token after every submit and holds a submit back until it has one, so a
 *   resubmit never carries the spent token. It only sees submits because it listens on the <form> itself; this
 *   component must respect its preventDefault (see handleSubmit).
 */
export function SignUpForm({
  defaultCountry,
  botProtection,
}: {
  defaultCountry: string | null;
  botProtection: ReactNode;
}) {
  const [state, formAction, isPending] = useActionState(signUpWithPassword, INITIAL_SIGN_UP_STATE);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // "Edit all details" applies to the result it was pressed on; the next failed submit narrows the form again.
  const [editAllFor, setEditAllFor] = useState<SignUpState | null>(null);

  const { fieldErrors, formError } = state;
  const errorCount = SIGN_UP_FIELDS.filter((field) => fieldErrors[field]).length;
  const shown = new Set(signUpFieldsToShow(fieldErrors, editAllFor === state));
  const narrowed = shown.size < SIGN_UP_FIELDS.length;

  useEffect(() => {
    const first = SIGN_UP_FIELDS.find((field) => state.fieldErrors[field]);
    if (first) document.getElementById(FIELD_INPUT_ID[first])?.focus();
  }, [state]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    // TurnstileWidget's listener has already run and cancels a submit that would go out without a token.
    if (e.defaultPrevented) return;
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(() => formAction(formData));
  }

  const describedBy = (field: SignUpField) => (fieldErrors[field] ? `${FIELD_INPUT_ID[field]}-error` : undefined);
  const errorFor = (field: SignUpField) => {
    const reason = fieldErrors[field];
    return reason ? <FieldError id={`${FIELD_INPUT_ID[field]}-error`}>{signUpReasonMessage(reason)}</FieldError> : null;
  };

  return (
    <form
      action={formAction}
      onSubmit={handleSubmit}
      // A hidden field the browser itself refuses can't be pointed at, so bring the whole form back.
      onInvalidCapture={(e) => {
        if ((e.target as HTMLElement).closest("[hidden]")) setEditAllFor(state);
      }}
      className="mt-6 w-full space-y-3"
    >
      {botProtection}

      {(errorCount > 0 || formError) && (
        <div role="alert" className="rounded-lg bg-danger/10 px-4 py-3 text-sm">
          {formError && <p className="text-danger">{signUpFormErrorMessage(formError)}</p>}
          {errorCount > 0 && (
            <p className={cn("font-semibold text-danger", formError && "mt-2")}>
              {errorCount === 1 ? "Just one thing to fix" : "A few things to fix"}
            </p>
          )}
          {errorCount > 0 && narrowed && <p className="mt-1 text-foreground-soft">Your other details are saved.</p>}
        </div>
      )}

      <div hidden={!shown.has("username")}>
        <label htmlFor="signup-username" className="block text-xs font-medium text-foreground-soft">
          Username
        </label>
        <input
          id="signup-username"
          type="text"
          name="username"
          required
          minLength={3}
          maxLength={20}
          pattern="[A-Za-z0-9_]+"
          title="Letters, numbers and underscores only"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          aria-invalid={fieldErrors.username ? true : undefined}
          aria-describedby={describedBy("username")}
          placeholder="3–20 letters, numbers, _"
          className={cn(INPUT_CLASS, "mt-1", fieldErrors.username && "border-danger")}
        />
        {errorFor("username")}
      </div>
      <div hidden={!shown.has("email")}>
        <label htmlFor="signup-email" className="block text-xs font-medium text-foreground-soft">
          Email
        </label>
        <input
          id="signup-email"
          type="email"
          name="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={describedBy("email")}
          placeholder="you@example.com"
          className={cn(INPUT_CLASS, "mt-1", fieldErrors.email && "border-danger")}
        />
        {fieldErrors.email === "email_taken" ? (
          <FieldError id="signup-email-error">
            {signUpReasonMessage("email_taken")}{" "}
            <Link href="/sign-in" className="font-medium underline">
              Sign in instead
            </Link>
          </FieldError>
        ) : (
          errorFor("email")
        )}
      </div>
      <div hidden={!shown.has("password")}>
        <label htmlFor="signup-password" className="block text-xs font-medium text-foreground-soft">
          Password
        </label>
        {/* Margin on a wrapper, not the input: PasswordInput centres its
            show/hide button against its own box. */}
        <div className="mt-1">
          <PasswordInput
            id="signup-password"
            name="password"
            required
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            invalid={Boolean(fieldErrors.password)}
            describedBy={describedBy("password")}
            className={cn(INPUT_CLASS, fieldErrors.password && "border-danger")}
          />
        </div>
        {errorFor("password")}
      </div>
      <div hidden={!shown.has("birthDate")}>
        <label htmlFor="signup-birth-month" className="block text-xs font-medium text-foreground-soft">
          Date of birth
        </label>
        <div className="mt-1">
          <BirthDateSelect
            id="signup-birth-month"
            minAge={MIN_AGE}
            invalid={Boolean(fieldErrors.birthDate)}
            describedBy={describedBy("birthDate")}
          />
        </div>
        {errorFor("birthDate") ?? (
          <p className="mt-1 text-xs text-foreground-soft">You must be at least {MIN_AGE} to use YuKon3t.</p>
        )}
      </div>
      <div hidden={!shown.has("phone")}>
        <VerifyMethodFields
          defaultCountry={defaultCountry}
          phoneError={fieldErrors.phone ? signUpReasonMessage(fieldErrors.phone) : null}
        />
      </div>

      {errorCount > 0 && narrowed && (
        <button
          type="button"
          onClick={() => setEditAllFor(state)}
          className="text-sm font-medium text-accent hover:underline"
        >
          Edit all details
        </button>
      )}

      <TurnstileWidget />
      <SubmitButton
        label="Create account"
        pendingLabel="Creating account..."
        pending={isPending}
        className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
      />
    </form>
  );
}
