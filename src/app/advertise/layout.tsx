import { AdvertiseTextProvider } from "@/components/advertise-text";
import { getDictionary, getLocale } from "@/lib/i18n/server";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getDictionary();
  return (
    <AdvertiseTextProvider locale={locale} text={t.advertise}>
      {children}
    </AdvertiseTextProvider>
  );
}
