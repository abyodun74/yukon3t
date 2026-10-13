import type { Dictionary } from "@/lib/i18n/en";
import { account } from "@/lib/i18n/pt/account";
import { advertise } from "@/lib/i18n/pt/advertise";
import { circles } from "@/lib/i18n/pt/circles";
import { collab } from "@/lib/i18n/pt/collab";
import { feed } from "@/lib/i18n/pt/feed";
import { invite } from "@/lib/i18n/pt/invite";
import { messages } from "@/lib/i18n/pt/messages";
import { pages } from "@/lib/i18n/pt/pages";
import { profile } from "@/lib/i18n/pt/profile";
import { settings } from "@/lib/i18n/pt/settings";
import { shared } from "@/lib/i18n/pt/shared";
import { shell } from "@/lib/i18n/pt/shell";
import { ui } from "@/lib/i18n/pt/ui";
import { vocab } from "@/lib/i18n/pt/vocab";

// The language's conventions are described at the top of common.ts.
export const pt: Dictionary = {
  shared,
  ui,
  messages,
  shell,
  feed,
  pages,
  profile,
  settings,
  invite,
  advertise,
  circles,
  collab,
  vocab,
  ...account,
};
