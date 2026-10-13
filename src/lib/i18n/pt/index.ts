import type { Dictionary } from "@/lib/i18n/en";
import { account } from "@/lib/i18n/pt/account";
import { feed } from "@/lib/i18n/pt/feed";
import { messages } from "@/lib/i18n/pt/messages";
import { pages } from "@/lib/i18n/pt/pages";
import { shared } from "@/lib/i18n/pt/shared";
import { shell } from "@/lib/i18n/pt/shell";
import { ui } from "@/lib/i18n/pt/ui";

// The language's conventions are described at the top of common.ts.
export const pt: Dictionary = {
  shared,
  ui,
  messages,
  shell,
  feed,
  pages,
  ...account,
};
