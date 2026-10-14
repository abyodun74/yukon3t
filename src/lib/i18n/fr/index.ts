import type { Dictionary } from "@/lib/i18n/en";
import { account } from "@/lib/i18n/fr/account";
import { advertise } from "@/lib/i18n/fr/advertise";
import { calls } from "@/lib/i18n/fr/calls";
import { circles } from "@/lib/i18n/fr/circles";
import { collab } from "@/lib/i18n/fr/collab";
import { feed } from "@/lib/i18n/fr/feed";
import { invite } from "@/lib/i18n/fr/invite";
import { live } from "@/lib/i18n/fr/live";
import { messages } from "@/lib/i18n/fr/messages";
import { muse } from "@/lib/i18n/fr/muse";
import { pages } from "@/lib/i18n/fr/pages";
import { profile } from "@/lib/i18n/fr/profile";
import { push } from "@/lib/i18n/fr/push";
import { settings } from "@/lib/i18n/fr/settings";
import { shared } from "@/lib/i18n/fr/shared";
import { shell } from "@/lib/i18n/fr/shell";
import { ui } from "@/lib/i18n/fr/ui";
import { vocab } from "@/lib/i18n/fr/vocab";

// The language's conventions are described at the top of common.ts.
export const fr: Dictionary = {
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
