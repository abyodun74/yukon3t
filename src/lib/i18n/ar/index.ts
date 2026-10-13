import type { Dictionary } from "@/lib/i18n/en";
import { account } from "@/lib/i18n/ar/account";
import { feed } from "@/lib/i18n/ar/feed";
import { messages } from "@/lib/i18n/ar/messages";
import { pages } from "@/lib/i18n/ar/pages";
import { shared } from "@/lib/i18n/ar/shared";
import { shell } from "@/lib/i18n/ar/shell";
import { ui } from "@/lib/i18n/ar/ui";

// The language's conventions are described at the top of common.ts.
export const ar: Dictionary = {
  shared,
  ui,
  messages,
  shell,
  feed,
  pages,
  ...account,
};
