import { FeedLayout } from "@/components/feed-layout";
import { CircleShareTextProvider } from "@/components/circle-share-text";
import { CollabShareTextProvider } from "@/components/collab-share-text";
import { getDictionary, getLocale } from "@/lib/i18n/server";

// Search lists Circles and collabs, and each one opens its share sheet on a long press (circle-long-press.tsx,
// collab-long-press.tsx).
export default async function Layout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getDictionary();
  return (
    <FeedLayout>
      <CircleShareTextProvider locale={locale} text={t.circleShare}>
        <CollabShareTextProvider locale={locale} text={t.collabShare}>
          {children}
        </CollabShareTextProvider>
      </CircleShareTextProvider>
    </FeedLayout>
  );
}
