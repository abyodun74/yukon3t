import type { Dictionary } from "@/lib/i18n/en";
import { account } from "@/lib/i18n/es/account";
import { feed } from "@/lib/i18n/es/feed";
import { messages } from "@/lib/i18n/es/messages";
import { pages } from "@/lib/i18n/es/pages";
import { shared } from "@/lib/i18n/es/shared";
import { shell } from "@/lib/i18n/es/shell";
import { ui } from "@/lib/i18n/es/ui";

// The language's conventions are described at the top of common.ts.
export const es: Dictionary = {
  shared,
  ui,
  messages,
  shell,
  feed,
  pages,
  ...account,
};
