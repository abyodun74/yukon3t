"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useMessagesText } from "@/components/ui-text";
import type { messagesEn } from "@/lib/i18n/en";
import { plural, type Locale } from "@/lib/i18n/locales";

/** A 4-8 digit PIN entry: numeric keypad, masked with a show toggle, and never captured by session replay. */
export function HiddenPinField({
  id,
  label,
  value,
  onChange,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const t = useMessagesText().t.hidden;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <div className="relative mt-1">
        <input
          id={id}
          type={visible ? "text" : "password"}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          minLength={4}
          maxLength={8}
          required
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 8))}
          // Digits, typed and read left to right in every language; the show/hide button stays on the right.
          dir="ltr"
          className="ph-no-capture w-full rounded-lg border border-line bg-surface px-4 py-2.5 pr-10 text-sm tracking-widest outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t.hidePin : t.showPin}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-foreground-soft hover:text-accent"
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}

export type HiddenPinError =
  | { error: "locked"; lockedUntil: number | null }
  | { error: "wrong"; attemptsLeft: number }
  | { error: string };

/** One wording for every PIN form's failures. `secret` is what was wrong: the PIN, or the account password. */
export function hiddenPinErrorMessage(
  result: HiddenPinError,
  locale: Locale,
  errors: typeof messagesEn.hidden.errors,
  secret: "pin" | "password" = "pin",
): string {
  switch (result.error) {
    case "locked": {
      const until = "lockedUntil" in result ? result.lockedUntil : null;
      if (!until) return errors.locked;
      const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
      return minutes >= 120
        ? plural(locale, errors.lockedHours, Math.round(minutes / 60))
        : plural(locale, errors.lockedMinutes, minutes);
    }
    case "wrong": {
      const left = "attemptsLeft" in result ? result.attemptsLeft : null;
      if (left === null) return secret === "pin" ? errors.wrongPin : errors.wrongPassword;
      return plural(locale, secret === "pin" ? errors.wrongPinLeft : errors.wrongPasswordLeft, left);
    }
    case "rate_limited":
    case "invalid":
    case "invalid_code":
    case "code_expired":
      return errors[result.error];
    default:
      return errors.other;
  }
}
