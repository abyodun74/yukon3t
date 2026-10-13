import { FeedTextProvider } from "@/components/feed-text";
import { getDictionary, getLocale } from "@/lib/i18n/server";

/**
 * The layout of every route whose posts, stories and people controls are in the reader's language: it hands them
 * that language's wording. A route without it still works, in English.
 */
export async function FeedLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getDictionary();
  return (
    <FeedTextProvider locale={locale} text={t.feed}>
      {children}
    </FeedTextProvider>
  );
}
