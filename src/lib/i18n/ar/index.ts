import type { Dictionary } from "@/lib/i18n/en";
import { account } from "@/lib/i18n/ar/account";
import { advertise } from "@/lib/i18n/ar/advertise";
import { calls } from "@/lib/i18n/ar/calls";
import { circles } from "@/lib/i18n/ar/circles";
import { collab } from "@/lib/i18n/ar/collab";
import { feed } from "@/lib/i18n/ar/feed";
import { invite } from "@/lib/i18n/ar/invite";
import { live } from "@/lib/i18n/ar/live";
import { messages } from "@/lib/i18n/ar/messages";
import { muse } from "@/lib/i18n/ar/muse";
import { pages } from "@/lib/i18n/ar/pages";
import { profile } from "@/lib/i18n/ar/profile";
import { settings } from "@/lib/i18n/ar/settings";
import { shared } from "@/lib/i18n/ar/shared";
import { shell } from "@/lib/i18n/ar/shell";
import { ui } from "@/lib/i18n/ar/ui";
import { vocab } from "@/lib/i18n/ar/vocab";

// The language's conventions are described at the top of common.ts.
export const ar: Dictionary = {
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
  ...account,
};
