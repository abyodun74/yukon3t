import type { Dictionary } from "@/lib/i18n/en";
import { account } from "@/lib/i18n/pt/account";
import { advertise } from "@/lib/i18n/pt/advertise";
import { calls } from "@/lib/i18n/pt/calls";
import { challenges } from "@/lib/i18n/pt/challenges";
import { circleShare } from "@/lib/i18n/pt/circleShare";
import { circles } from "@/lib/i18n/pt/circles";
import { collab } from "@/lib/i18n/pt/collab";
import { commentTools } from "@/lib/i18n/pt/commentTools";
import { feed } from "@/lib/i18n/pt/feed";
import { gifts } from "@/lib/i18n/pt/gifts";
import { invite } from "@/lib/i18n/pt/invite";
import { live } from "@/lib/i18n/pt/live";
import { messages } from "@/lib/i18n/pt/messages";
import { muse } from "@/lib/i18n/pt/muse";
import { museComments } from "@/lib/i18n/pt/museComments";
import { pages } from "@/lib/i18n/pt/pages";
import { profile } from "@/lib/i18n/pt/profile";
import { push } from "@/lib/i18n/pt/push";
import { settings } from "@/lib/i18n/pt/settings";
import { shared } from "@/lib/i18n/pt/shared";
import { shell } from "@/lib/i18n/pt/shell";
import { postUpload } from "@/lib/i18n/pt/postUpload";
import { storyUpload } from "@/lib/i18n/pt/storyUpload";
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
  postUpload,
  ...account,
};
