import Link from "next/link";
import { getDictionary } from "@/lib/i18n/server";

export default async function AdvertiseSuccessPage() {
  const t = (await getDictionary()).advertise.success;
  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">{t.eyebrow}</p>
      <h1 className="font-display mt-2 text-2xl font-semibold">{t.title}</h1>
      <p className="mt-3 text-sm text-foreground-soft">{t.body}</p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-ink"
      >
        {t.back}
      </Link>
    </div>
  );
}
