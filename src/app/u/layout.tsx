import { FeedLayout } from "@/components/feed-layout";
import { ProfileTextProvider } from "@/components/profile-text";
import { getDictionary, getLocale } from "@/lib/i18n/server";

// A profile shows posts (the feed's wording) and its own controls (the profile's).
export default async function Layout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getDictionary();
  return (
    <FeedLayout>
      <ProfileTextProvider locale={locale} text={t.profile}>
        {children}
      </ProfileTextProvider>
    </FeedLayout>
  );
}
