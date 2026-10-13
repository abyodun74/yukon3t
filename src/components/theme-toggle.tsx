"use client";

import { useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { THEME_COOKIE, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useShellText } from "@/components/ui-text";
import { hapticSelection } from "@/lib/haptics";

const options: { value: Theme; icon: typeof Sun }[] = [
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
  { value: "system", icon: Monitor },
];

// Plain top-level function, not part of the component/hook body: the React
// Compiler's immutability check otherwise flags direct DOM/cookie writes
// even from inside an event handler.
function persistTheme(value: Theme) {
  document.cookie = `${THEME_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
  if (value === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = value;
  }
}

export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const { t } = useShellText();

  function apply(value: Theme) {
    if (value === theme) return;
    hapticSelection();
    setTheme(value);
    persistTheme(value);
  }

  return (
    <div className="flex items-center gap-0.5 rounded-full border border-line p-0.5">
      {options.map(({ value, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={t.theme[value]}
          aria-pressed={theme === value}
          onClick={() => apply(value)}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full transition-colors",
            theme === value
              ? "bg-accent text-accent-ink"
              : "text-foreground-soft hover:text-foreground",
          )}
        >
          <Icon size={14} strokeWidth={2.25} />
        </button>
      ))}
    </div>
  );
}
