import { MessagesTextProvider } from "@/components/ui-text";
import { localeDirection } from "@/lib/i18n/locales";
import { getDictionary, getLocale } from "@/lib/i18n/server";

// Everything under /messages is in the reader's language (the app shell around it is English), so this is where
// its lang/dir and its wording for client components come from.
export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getDictionary();

  return (
    <MessagesTextProvider locale={locale} text={t.messages}>
      <div lang={locale} dir={localeDirection(locale)}>
        {children}
      </div>
    </MessagesTextProvider>
  );
}
