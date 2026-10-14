import { LiveTextProvider } from "@/components/live-text";
import { getDictionary, getLocale } from "@/lib/i18n/server";

// The live stream room is in the reader's language; its video tiles get theirs from the root layout (calls).
export default async function Layout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getDictionary();
  return (
    <LiveTextProvider locale={locale} text={t.live}>
      {children}
    </LiveTextProvider>
  );
}
