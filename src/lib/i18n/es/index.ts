import type { Dictionary } from "@/lib/i18n/en";
import { account } from "@/lib/i18n/es/account";
import { advertise } from "@/lib/i18n/es/advertise";
import { circles } from "@/lib/i18n/es/circles";
import { collab } from "@/lib/i18n/es/collab";
import { feed } from "@/lib/i18n/es/feed";
import { invite } from "@/lib/i18n/es/invite";
import { messages } from "@/lib/i18n/es/messages";
import { pages } from "@/lib/i18n/es/pages";
import { profile } from "@/lib/i18n/es/profile";
import { settings } from "@/lib/i18n/es/settings";
import { shared } from "@/lib/i18n/es/shared";
import { shell } from "@/lib/i18n/es/shell";
import { ui } from "@/lib/i18n/es/ui";
import { vocab } from "@/lib/i18n/es/vocab";

// The language's conventions are described at the top of common.ts.
export const es: Dictionary = {
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
