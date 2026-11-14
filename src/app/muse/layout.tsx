import { FeedLayout } from "@/components/feed-layout";
import { MuseTextProvider } from "@/components/muse-text";
import { MuseCommentsTextProvider } from "@/components/muse-comments-text";
import { getDictionary, getLocale } from "@/lib/i18n/server";

// Muse shows its own player and composer (Muse's wording) and the subscribe and share controls (the feed's).
export default async function Layout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getDictionary();
  return (
    <FeedLayout>
      <MuseTextProvider locale={locale} text={t.muse}>
        <MuseCommentsTextProvider locale={locale} text={t.museComments}>
          {children}
        </MuseCommentsTextProvider>
      </MuseTextProvider>
    </FeedLayout>
  );
}
