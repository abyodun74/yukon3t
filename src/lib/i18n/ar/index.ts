import type { Dictionary } from "@/lib/i18n/en";
import { account } from "@/lib/i18n/ar/account";
import { advertise } from "@/lib/i18n/ar/advertise";
import { calls } from "@/lib/i18n/ar/calls";
import { challenges } from "@/lib/i18n/ar/challenges";
import { circleShare } from "@/lib/i18n/ar/circleShare";
import { circles } from "@/lib/i18n/ar/circles";
import { collab } from "@/lib/i18n/ar/collab";
import { commentTools } from "@/lib/i18n/ar/commentTools";
import { feed } from "@/lib/i18n/ar/feed";
import { gifts } from "@/lib/i18n/ar/gifts";
import { invite } from "@/lib/i18n/ar/invite";
import { live } from "@/lib/i18n/ar/live";
import { messages } from "@/lib/i18n/ar/messages";
import { muse } from "@/lib/i18n/ar/muse";
import { museComments } from "@/lib/i18n/ar/museComments";
import { pages } from "@/lib/i18n/ar/pages";
import { profile } from "@/lib/i18n/ar/profile";
import { push } from "@/lib/i18n/ar/push";
import { settings } from "@/lib/i18n/ar/settings";
import { shared } from "@/lib/i18n/ar/shared";
import { shell } from "@/lib/i18n/ar/shell";
import { storyUpload } from "@/lib/i18n/ar/storyUpload";
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
  museComments,
  live,
  calls,
  vocab,
  push,
  gifts,
  challenges,
  circleShare,
  commentTools,
  storyUpload,
  ...account,
};
