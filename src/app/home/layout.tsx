import { FeedLayout } from "@/components/feed-layout";
import { MuseTextProvider } from "@/components/muse-text";
import { getDictionary, getLocale } from "@/lib/i18n/server";

// Home shows posts (the feed's wording) and opens a short video in the Muse viewer (Muse's).
export default async function Layout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getDictionary();
  return (
    <FeedLayout>
      <MuseTextProvider locale={locale} text={t.muse}>
        {children}
      </MuseTextProvider>
    </FeedLayout>
  );
}
