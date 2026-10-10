"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

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
          className="ph-no-capture w-full rounded-lg border border-line bg-surface px-4 py-2.5 pr-10 text-sm tracking-widest outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide PIN" : "Show PIN"}
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

/** One wording for every PIN form's failures. `secret` names what was wrong ("PIN", "password"). */
export function hiddenPinErrorMessage(result: HiddenPinError, secret = "PIN"): string {
  switch (result.error) {
    case "locked": {
      const until = "lockedUntil" in result ? result.lockedUntil : null;
      if (!until) return "Too many attempts. Try again in a little while.";
      const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
      return minutes >= 120
        ? `Too many wrong attempts. Try again in about ${Math.round(minutes / 60)} hours.`
        : `Too many wrong attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    }
    case "wrong": {
      const left = "attemptsLeft" in result ? result.attemptsLeft : null;
      return left === null
        ? `Wrong ${secret}.`
        : `Wrong ${secret}. ${left} attempt${left === 1 ? "" : "s"} left before a timeout.`;
    }
    case "rate_limited":
      return "Too many attempts. Try again in a few minutes.";
    case "invalid":
      return "Enter a PIN of 4 to 8 digits, the same both times.";
    case "invalid_code":
      return "That code isn't right.";
    case "code_expired":
      return "That code has expired. Ask for a new one.";
    default:
      return "Something went wrong. Try again.";
  }
}
