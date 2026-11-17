import type { Dictionary } from "@/lib/i18n/en";
import { account } from "@/lib/i18n/it/account";
import { advertise } from "@/lib/i18n/it/advertise";
import { appLinks } from "@/lib/i18n/it/appLinks";
import { calls } from "@/lib/i18n/it/calls";
import { challenges } from "@/lib/i18n/it/challenges";
import { circleShare } from "@/lib/i18n/it/circleShare";
import { collabShare } from "@/lib/i18n/it/collabShare";
import { circles } from "@/lib/i18n/it/circles";
import { collab } from "@/lib/i18n/it/collab";
import { commentTools } from "@/lib/i18n/it/commentTools";
import { feed } from "@/lib/i18n/it/feed";
import { gifts } from "@/lib/i18n/it/gifts";
import { invite } from "@/lib/i18n/it/invite";
import { live } from "@/lib/i18n/it/live";
import { messages } from "@/lib/i18n/it/messages";
import { muse } from "@/lib/i18n/it/muse";
import { museComments } from "@/lib/i18n/it/museComments";
import { museControls } from "@/lib/i18n/it/museControls";
import { pages } from "@/lib/i18n/it/pages";
import { profile } from "@/lib/i18n/it/profile";
import { push } from "@/lib/i18n/it/push";
import { settings } from "@/lib/i18n/it/settings";
import { shared } from "@/lib/i18n/it/shared";
import { shell } from "@/lib/i18n/it/shell";
import { postUpload } from "@/lib/i18n/it/postUpload";
import { storyUpload } from "@/lib/i18n/it/storyUpload";
import { ui } from "@/lib/i18n/it/ui";
import { vocab } from "@/lib/i18n/it/vocab";

// The language's conventions are described at the top of common.ts.
export const it: Dictionary = {
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
