"use client";

import { useState, type ChangeEventHandler } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { sharedEn } from "@/lib/i18n/en/shared";

export function PasswordInput({
  id,
  name,
  required,
  minLength,
  maxLength,
  placeholder,
  className,
  wrapperClassName,
  autoComplete,
  autoCapitalize,
  autoCorrect,
  spellCheck,
  value,
  onChange,
  defaultVisible = false,
  invalid = false,
  describedBy,
  labels = sharedEn.passwordInput,
}: {
  id?: string;
  name?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  placeholder?: string;
  className?: string;
  wrapperClassName?: string;
  autoComplete?: string;
  autoCapitalize?: string;
  autoCorrect?: string;
  spellCheck?: boolean;
  /** Pass with `onChange` to control the field; omit both to leave it uncontrolled (a plain form field read by `name`). */
  value?: string;
  onChange?: ChangeEventHandler<HTMLInputElement>;
  /** Start with the characters showing; the eye button still hides them. */
  defaultVisible?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** The show/hide button's names, for the account screens that aren't in English. */
  labels?: typeof sharedEn.passwordInput;
}) {
  const [visible, setVisible] = useState(defaultVisible);

  return (
    <div className={cn("relative", wrapperClassName)}>
      <input
        id={id}
        type={visible ? "text" : "password"}
        name={name}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        spellCheck={spellCheck}
        value={value}
        onChange={onChange}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        // The eye button sits at the end of the field, which is the left on the Arabic account screens.
        className={cn(className, "ltr-value pr-10 rtl:pl-10 rtl:pr-4")}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? labels.hide : labels.show}
        className="absolute inset-y-0 right-0 flex rtl:left-0 rtl:right-auto items-center px-3 text-foreground-soft hover:text-accent"
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
