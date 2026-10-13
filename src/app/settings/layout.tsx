import { InviteTextProvider } from "@/components/invite-text";
import { SettingsTextProvider } from "@/components/settings-text";
import { getDictionary, getLocale } from "@/lib/i18n/server";

// Where the wording of the client components under /settings comes from (the invite panel is one of them).
export default async function Layout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getDictionary();
  return (
    <SettingsTextProvider locale={locale} text={t.settings}>
      <InviteTextProvider locale={locale} text={t.invite}>
        {children}
      </InviteTextProvider>
    </SettingsTextProvider>
  );
}
