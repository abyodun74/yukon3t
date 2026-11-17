import type { Dictionary } from "@/lib/i18n/en";
import { account } from "@/lib/i18n/sw/account";
import { advertise } from "@/lib/i18n/sw/advertise";
import { appLinks } from "@/lib/i18n/sw/appLinks";
import { calls } from "@/lib/i18n/sw/calls";
import { challenges } from "@/lib/i18n/sw/challenges";
import { circleShare } from "@/lib/i18n/sw/circleShare";
import { collabShare } from "@/lib/i18n/sw/collabShare";
import { circles } from "@/lib/i18n/sw/circles";
import { collab } from "@/lib/i18n/sw/collab";
import { commentTools } from "@/lib/i18n/sw/commentTools";
import { feed } from "@/lib/i18n/sw/feed";
import { gifts } from "@/lib/i18n/sw/gifts";
import { invite } from "@/lib/i18n/sw/invite";
import { live } from "@/lib/i18n/sw/live";
import { messages } from "@/lib/i18n/sw/messages";
import { muse } from "@/lib/i18n/sw/muse";
import { museComments } from "@/lib/i18n/sw/museComments";
import { museControls } from "@/lib/i18n/sw/museControls";
import { pages } from "@/lib/i18n/sw/pages";
import { profile } from "@/lib/i18n/sw/profile";
import { push } from "@/lib/i18n/sw/push";
import { settings } from "@/lib/i18n/sw/settings";
import { shared } from "@/lib/i18n/sw/shared";
import { shell } from "@/lib/i18n/sw/shell";
import { postUpload } from "@/lib/i18n/sw/postUpload";
import { storyUpload } from "@/lib/i18n/sw/storyUpload";
import { ui } from "@/lib/i18n/sw/ui";
import { vocab } from "@/lib/i18n/sw/vocab";

// The language's conventions are described at the top of common.ts.
export const sw: Dictionary = {
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
  museControls,
  live,
  calls,
  vocab,
  push,
  gifts,
  challenges,
  circleShare,
  collabShare,
  commentTools,
  storyUpload,
  postUpload,
  appLinks,
  ...account,
};
