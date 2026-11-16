import { CollabTextProvider } from "@/components/collab-text";
import { CollabShareTextProvider } from "@/components/collab-share-text";
import { FeedLayout } from "@/components/feed-layout";
import { MessagesTextProvider } from "@/components/messages-text";
import { getDictionary, getLocale } from "@/lib/i18n/server";

// A collaboration's page has the connect and subscribe controls (the feed's wording), a group chat (the messages')
// and its own controls (Collab's), plus the Collab share sheet (long press on a card, Share on a collab's page).
export default async function Layout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getDictionary();
  return (
    <FeedLayout>
      <MessagesTextProvider locale={locale} text={t.messages}>
        <CollabTextProvider locale={locale} text={t.collab}>
          <CollabShareTextProvider locale={locale} text={t.collabShare}>
            {children}
          </CollabShareTextProvider>
        </CollabTextProvider>
      </MessagesTextProvider>
    </FeedLayout>
  );
}
