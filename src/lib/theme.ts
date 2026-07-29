export const THEME_COOKIE = "yk3-theme";
export const THEME_VALUES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEME_VALUES)[number];

export function parseTheme(value: string | undefined | null): Theme {
  return (THEME_VALUES as readonly string[]).includes(value ?? "")
    ? (value as Theme)
    : "system";
}
