import { InviteTextProvider } from "@/components/invite-text";
import { getDictionary, getLocale } from "@/lib/i18n/server";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getDictionary();
  return (
    <InviteTextProvider locale={locale} text={t.invite}>
      {children}
    </InviteTextProvider>
  );
}
