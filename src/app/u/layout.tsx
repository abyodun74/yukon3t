import { FeedLayout } from "@/components/feed-layout";
import { MuseTextProvider } from "@/components/muse-text";
import { ProfileTextProvider } from "@/components/profile-text";
import { getDictionary, getLocale } from "@/lib/i18n/server";

// A profile shows posts (the feed's wording), its own controls (the profile's), and for its owner the Muse composer.
export default async function Layout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getDictionary();
  return (
    <FeedLayout>
      <ProfileTextProvider locale={locale} text={t.profile}>
        <MuseTextProvider locale={locale} text={t.muse}>
          {children}
        </MuseTextProvider>
      </ProfileTextProvider>
    </FeedLayout>
  );
}
