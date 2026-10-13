import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AdSlot } from "@/components/ad-slot";
import { LanguagePicker } from "@/components/language-picker";
import { getDictionary, getLocale } from "@/lib/i18n/server";

const title = "YuKon3t — Verified Global Friendships, No Fake Profiles";
const description =
  "Connect worldwide with real, verified people. Join free Circles, skill-exchange Collab Boards, and cross-cultural friendships — no catfishing, no silent bans.";

// Overrides the root layout's default title/description (rather than
// relying on its "%s | YuKon3t" template) since this string already carries
// the brand name — the landing page is the canonical page that string
// belongs on. OpenGraph/Twitter are repeated in full (not just
// title/description) because Next.js metadata doesn't deep-merge nested
// objects with the parent layout's — declaring `openGraph` here without
// `images` would silently drop the icon the root layout sets.
export const metadata: Metadata = {
  title: { absolute: title },
  description,
  openGraph: {
    type: "website",
    url: "/",
    siteName: "YuKon3t",
    title,
    description,
    images: [{ url: "/icons/icon-512.png", width: 512, height: 512 }],
  },
  twitter: {
    card: "summary",
    title,
    description,
    images: ["/icons/icon-512.png"],
  },
};

export default async function Home() {
  const session = await auth();
  if (session?.user) {
    redirect("/home");
  }
  const locale = await getLocale();
  const t = await getDictionary();

  return (
    <div lang={locale}>
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
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">
            {t.landing.eyebrow}
          </p>
          <h1 className="font-display mt-4 text-4xl font-semibold italic tracking-tight text-balance sm:text-6xl">
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

      <section className="mx-auto max-w-5xl px-4 py-16 text-center">
        <h2 className="font-display text-2xl font-semibold">{t.landing.waysTitle}</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="rounded-xl border border-line p-6 text-left shadow-[var(--shadow-sm)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]">
            <h3 className="font-display font-semibold text-teal">{t.landing.circles.title}</h3>
            <p className="mt-2 text-sm text-foreground-soft">{t.landing.circles.body}</p>
          </div>
          <div className="rounded-xl border border-line p-6 text-left shadow-[var(--shadow-sm)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]">
            <h3 className="font-display font-semibold text-teal">{t.landing.collabBoards.title}</h3>
            <p className="mt-2 text-sm text-foreground-soft">{t.landing.collabBoards.body}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
