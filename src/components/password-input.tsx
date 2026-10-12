"use client";

import { useState, type ChangeEventHandler } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

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
        className={cn(className, "pr-10")}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-foreground-soft hover:text-accent"
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
