import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AdSlot } from "@/components/ad-slot";
import { LanguagePicker } from "@/components/language-picker";
import { getDictionary, getLocale, getSeoLocaleOverride } from "@/lib/i18n/server";
import { JsonLd } from "@/components/json-ld";
import { landingJsonLd, localizedPageMetadata } from "@/lib/seo";

// Only this page's headline is italic: loading the face here (not in the root layout) keeps it off every other route.
// See .font-display-italic in globals.css.
const frauncesItalic = localFont({
  src: "./fonts/Fraunces-Italic-Variable.woff2",
  weight: "500 700",
  style: "italic",
  variable: "--font-fraunces-italic",
});

// Title, description and link previews in the reader's language (dictionary `seo.landing`), with a canonical link and
// hreflang alternates for the `?lang=` addresses (src/lib/seo-locale.ts, src/lib/seo.ts). The title is absolute: it
// already carries the brand name, so the root layout's "%s | YuKon3t" template would double it.
export async function generateMetadata(): Promise<Metadata> {
  const [locale, seoLocale, dictionary] = await Promise.all([getLocale(), getSeoLocaleOverride(), getDictionary()]);
  return localizedPageMetadata({ path: "/", locale, seoLocale, text: dictionary.seo.landing });
}

export default async function Home() {
  const session = await auth();
  if (session?.user) {
    redirect("/home");
  }
  const locale = await getLocale();
  const t = await getDictionary();

  return (
    <div>
      <JsonLd data={landingJsonLd({ locale, description: t.seo.landing.description })} />
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(60% 50% at 50% 0%, var(--accent-soft) 0%, transparent 70%)",
          }}
        />
        <div className="absolute inset-x-0 top-0 z-10">
          <div className="mx-auto flex max-w-6xl justify-end px-4 pt-3">
            <LanguagePicker
              locale={locale}
              label={t.languagePicker.label}
              className="mt-0 w-auto justify-end"
            />
          </div>
        </div>
        <div className="mx-auto max-w-5xl px-4 pb-20 pt-24 text-center sm:pb-28 sm:pt-28">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent rtl:text-sm rtl:tracking-normal">
            {t.landing.eyebrow}
          </p>
          <h1 className={`${frauncesItalic.variable} font-display-italic mt-4 text-4xl font-semibold italic tracking-tight text-balance sm:text-6xl rtl:not-italic rtl:leading-snug rtl:tracking-normal sm:rtl:leading-snug`}>
            {t.landing.title}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-foreground-soft">
            {t.landing.intro}
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link
              href="/sign-up"
              className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-ink shadow-[var(--shadow-md)] hover:-translate-y-0.5"
            >
              {t.landing.createAccount}
            </Link>
            <Link
              href="/legal/guidelines"
              className="rounded-full border border-line px-6 py-3 text-sm font-semibold hover:-translate-y-0.5 hover:border-accent hover:text-accent"
            >
              {t.landing.guidelines}
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-2xl px-4 pb-4">
        <AdSlot />
      </section>

      <section className="border-t border-line bg-surface py-16">
        <div className="mx-auto grid max-w-5xl gap-8 px-4 sm:grid-cols-2">
          {t.landing.pillars.map((pillar) => (
            <div
              key={pillar.title}
              className="rounded-xl border border-line p-6 shadow-[var(--shadow-sm)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]"
            >
              <h2 className="font-display text-lg font-semibold">{pillar.title}</h2>
              <p className="mt-2 text-sm text-foreground-soft">{pillar.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* What the app does, feature by feature, in the reader's language: server-rendered so search engines read it. */}
      <section aria-labelledby="landing-features" className="mx-auto max-w-5xl px-4 pt-16">
        <h2 id="landing-features" className="font-display text-center text-2xl font-semibold text-balance">
          {t.landing.features.heading}
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-foreground-soft">{t.landing.features.intro}</p>
        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {t.landing.features.items.map((feature) => (
            <li
              key={feature.title}
              className="rounded-xl border border-line p-6 text-start shadow-[var(--shadow-sm)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]"
            >
              <h3 className="font-display font-semibold text-teal">{feature.title}</h3>
              <p className="mt-2 text-sm text-foreground-soft">{feature.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16 text-center">
        <h2 className="font-display text-2xl font-semibold">{t.landing.waysTitle}</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="rounded-xl border border-line p-6 text-start shadow-[var(--shadow-sm)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]">
            <h3 className="font-display font-semibold text-teal">{t.landing.circles.title}</h3>
            <p className="mt-2 text-sm text-foreground-soft">{t.landing.circles.body}</p>
          </div>
          <div className="rounded-xl border border-line p-6 text-start shadow-[var(--shadow-sm)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]">
            <h3 className="font-display font-semibold text-teal">{t.landing.collabBoards.title}</h3>
            <p className="mt-2 text-sm text-foreground-soft">{t.landing.collabBoards.body}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
