import type { Dictionary } from "@/lib/i18n/en";
import { account } from "@/lib/i18n/pt/account";
import { advertise } from "@/lib/i18n/pt/advertise";
import { calls } from "@/lib/i18n/pt/calls";
import { circles } from "@/lib/i18n/pt/circles";
import { collab } from "@/lib/i18n/pt/collab";
import { feed } from "@/lib/i18n/pt/feed";
import { invite } from "@/lib/i18n/pt/invite";
import { live } from "@/lib/i18n/pt/live";
import { messages } from "@/lib/i18n/pt/messages";
import { muse } from "@/lib/i18n/pt/muse";
import { pages } from "@/lib/i18n/pt/pages";
import { profile } from "@/lib/i18n/pt/profile";
import { push } from "@/lib/i18n/pt/push";
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
  muse,
  live,
  calls,
  vocab,
  push,
  ...account,
};
