import { FeedLayout } from "@/components/feed-layout";
import { GiftsTextProvider } from "@/components/gifts-text";
import { requireGiftsUser } from "@/lib/gift-gate";
import { getDictionary, getLocale } from "@/lib/i18n/server";

// The gift marketplace (src/lib/gift-market.ts): the app's usual frame, and the gifts wording for its client parts.
// The gate runs FIRST, before the dictionary is read: a layout runs before its pages, so without this a signed-out
// visitor or a non-admin would get the gifts wording in the redirect / 404 response. Being above loading.tsx's
// Suspense boundary, a signed-out redirect is also a real 307 rather than a streamed 200.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireGiftsUser();
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
