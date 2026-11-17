import type { Dictionary } from "@/lib/i18n/en";
import { account } from "@/lib/i18n/hi/account";
import { advertise } from "@/lib/i18n/hi/advertise";
import { appLinks } from "@/lib/i18n/hi/appLinks";
import { calls } from "@/lib/i18n/hi/calls";
import { challenges } from "@/lib/i18n/hi/challenges";
import { circleShare } from "@/lib/i18n/hi/circleShare";
import { collabShare } from "@/lib/i18n/hi/collabShare";
import { circles } from "@/lib/i18n/hi/circles";
import { collab } from "@/lib/i18n/hi/collab";
import { commentTools } from "@/lib/i18n/hi/commentTools";
import { feed } from "@/lib/i18n/hi/feed";
import { gifts } from "@/lib/i18n/hi/gifts";
import { invite } from "@/lib/i18n/hi/invite";
import { live } from "@/lib/i18n/hi/live";
import { messages } from "@/lib/i18n/hi/messages";
import { muse } from "@/lib/i18n/hi/muse";
import { museComments } from "@/lib/i18n/hi/museComments";
import { museControls } from "@/lib/i18n/hi/museControls";
import { pages } from "@/lib/i18n/hi/pages";
import { profile } from "@/lib/i18n/hi/profile";
import { push } from "@/lib/i18n/hi/push";
import { settings } from "@/lib/i18n/hi/settings";
import { shared } from "@/lib/i18n/hi/shared";
import { shell } from "@/lib/i18n/hi/shell";
import { postUpload } from "@/lib/i18n/hi/postUpload";
import { storyUpload } from "@/lib/i18n/hi/storyUpload";
import { ui } from "@/lib/i18n/hi/ui";
import { vocab } from "@/lib/i18n/hi/vocab";

// The language's conventions are described at the top of common.ts.
export const hi: Dictionary = {
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
