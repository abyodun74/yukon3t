import { CirclesTextProvider } from "@/components/circles-text";
import { FeedLayout } from "@/components/feed-layout";
import { getDictionary, getLocale } from "@/lib/i18n/server";

// A Circle's page shows posts and the composer (the feed's wording) and its own controls (the Circles').
export default async function Layout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getDictionary();
  return (
    <FeedLayout>
      <CirclesTextProvider locale={locale} text={t.circles}>
        {children}
      </CirclesTextProvider>
    </FeedLayout>
  );
}
