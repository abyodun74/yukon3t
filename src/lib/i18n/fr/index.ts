import type { Dictionary } from "@/lib/i18n/en";
import { account } from "@/lib/i18n/fr/account";
import { feed } from "@/lib/i18n/fr/feed";
import { messages } from "@/lib/i18n/fr/messages";
import { pages } from "@/lib/i18n/fr/pages";
import { shared } from "@/lib/i18n/fr/shared";
import { shell } from "@/lib/i18n/fr/shell";
import { ui } from "@/lib/i18n/fr/ui";

// The language's conventions are described at the top of common.ts.
export const fr: Dictionary = {
  shared,
  ui,
  messages,
  shell,
  feed,
  pages,
  ...account,
};
