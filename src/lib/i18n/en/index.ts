// English, and the shape every other language is typed against: a key missing in es/, fr/, pt/ or ar/ is a compile
// error. One module per area, and each area's module is what its provider's hook defaults to (src/components/
// ui-text.tsx), so a client component imports its own area's file, never this index. Placeholders are `{name}`,
// filled by format() in locales.ts.

import { accountEn } from "@/lib/i18n/en/account";
import { feedEn } from "@/lib/i18n/en/feed";
import { messagesEn } from "@/lib/i18n/en/messages";
import { pagesEn } from "@/lib/i18n/en/pages";
import { sharedEn } from "@/lib/i18n/en/shared";
import { shellEn } from "@/lib/i18n/en/shell";
import { uiEn } from "@/lib/i18n/en/ui";

export { accountEn, feedEn, messagesEn, pagesEn, sharedEn, shellEn, uiEn };

export const en = {
  shared: sharedEn,
  ui: uiEn,
  messages: messagesEn,
  shell: shellEn,
  feed: feedEn,
  pages: pagesEn,
  ...accountEn,
};

export type Dictionary = typeof en;
