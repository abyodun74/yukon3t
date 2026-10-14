// English, and the shape every other language is typed against: a key missing in es/, fr/, pt/ or ar/ is a compile
// error. One module per area, and each area's module is what its provider's hook defaults to (src/components/
// ui-text.tsx), so a client component imports its own area's file, never this index. Placeholders are `{name}`,
// filled by format() in locales.ts.

import { accountEn } from "@/lib/i18n/en/account";
import { advertiseEn } from "@/lib/i18n/en/advertise";
import { callsEn } from "@/lib/i18n/en/calls";
import { circlesEn } from "@/lib/i18n/en/circles";
import { collabEn } from "@/lib/i18n/en/collab";
import { feedEn } from "@/lib/i18n/en/feed";
import { inviteEn } from "@/lib/i18n/en/invite";
import { liveEn } from "@/lib/i18n/en/live";
import { messagesEn } from "@/lib/i18n/en/messages";
import { museEn } from "@/lib/i18n/en/muse";
import { pagesEn } from "@/lib/i18n/en/pages";
import { profileEn } from "@/lib/i18n/en/profile";
import { settingsEn } from "@/lib/i18n/en/settings";
import { sharedEn } from "@/lib/i18n/en/shared";
import { shellEn } from "@/lib/i18n/en/shell";
import { uiEn } from "@/lib/i18n/en/ui";
import { vocabEn } from "@/lib/i18n/en/vocab";

export {
  accountEn,
  advertiseEn,
  callsEn,
  circlesEn,
  collabEn,
  feedEn,
  inviteEn,
  liveEn,
  messagesEn,
  museEn,
  pagesEn,
  profileEn,
  settingsEn,
  sharedEn,
  shellEn,
  uiEn,
  vocabEn,
};

export const en = {
  shared: sharedEn,
  ui: uiEn,
  messages: messagesEn,
  shell: shellEn,
  feed: feedEn,
  pages: pagesEn,
  profile: profileEn,
  settings: settingsEn,
  invite: inviteEn,
  advertise: advertiseEn,
  circles: circlesEn,
  collab: collabEn,
  muse: museEn,
  live: liveEn,
  calls: callsEn,
  vocab: vocabEn,
  ...accountEn,
};

export type Dictionary = typeof en;
