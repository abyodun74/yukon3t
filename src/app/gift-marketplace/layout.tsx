import { FeedLayout } from "@/components/feed-layout";
import { GiftsTextProvider } from "@/components/gifts-text";
import { getDictionary, getLocale } from "@/lib/i18n/server";

// The gift marketplace (src/lib/gift-market.ts): the app's usual frame, and the gifts wording for its client parts.
export default async function Layout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getDictionary();
  return (
    <FeedLayout>
      <GiftsTextProvider locale={locale} text={t.gifts}>
        {children}
      </GiftsTextProvider>
    </FeedLayout>
  );
}
