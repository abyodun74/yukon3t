import type { Dictionary } from "@/lib/i18n/en";
import { account } from "@/lib/i18n/de/account";
import { advertise } from "@/lib/i18n/de/advertise";
import { appLinks } from "@/lib/i18n/de/appLinks";
import { calls } from "@/lib/i18n/de/calls";
import { challenges } from "@/lib/i18n/de/challenges";
import { circleShare } from "@/lib/i18n/de/circleShare";
import { collabShare } from "@/lib/i18n/de/collabShare";
import { circles } from "@/lib/i18n/de/circles";
import { collab } from "@/lib/i18n/de/collab";
import { commentTools } from "@/lib/i18n/de/commentTools";
import { feed } from "@/lib/i18n/de/feed";
import { gifts } from "@/lib/i18n/de/gifts";
import { invite } from "@/lib/i18n/de/invite";
import { live } from "@/lib/i18n/de/live";
import { messages } from "@/lib/i18n/de/messages";
import { muse } from "@/lib/i18n/de/muse";
import { museComments } from "@/lib/i18n/de/museComments";
import { museControls } from "@/lib/i18n/de/museControls";
import { pages } from "@/lib/i18n/de/pages";
import { profile } from "@/lib/i18n/de/profile";
import { push } from "@/lib/i18n/de/push";
import { settings } from "@/lib/i18n/de/settings";
import { shared } from "@/lib/i18n/de/shared";
import { shell } from "@/lib/i18n/de/shell";
import { postUpload } from "@/lib/i18n/de/postUpload";
import { storyUpload } from "@/lib/i18n/de/storyUpload";
import { ui } from "@/lib/i18n/de/ui";
import { vocab } from "@/lib/i18n/de/vocab";

// The language's conventions are described at the top of common.ts.
export const de: Dictionary = {
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
