import { MessagesTextProvider } from "@/components/messages-text";
import { getDictionary, getLocale } from "@/lib/i18n/server";

// Where the wording of the client components under /messages comes from.
export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = await getDictionary();

  return (
    <MessagesTextProvider locale={locale} text={t.messages}>
      {children}
    </MessagesTextProvider>
  );
}
