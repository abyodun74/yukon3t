import type { Metadata } from "next";
import { isPaymentsConfigured } from "@/lib/stripe";
import { AD_PRICE_PER_DAY_CENTS, formatCents } from "@/lib/ads";
import { AdBookingForm } from "@/components/ad-booking-form";
import { aroundPlaceholder } from "@/lib/i18n/locales";
import { getDictionary } from "@/lib/i18n/server";

const title = "Advertise on YuKon3t — Self-Serve Ads, No Minimum";
const description =
  "Reach a global, verified audience with pay-as-you-go ads. Set your budget, launch in minutes — no agency, no monthly minimum spend required.";

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  openGraph: {
    type: "website",
    url: "/advertise",
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

export default async function AdvertisePage({
  searchParams,
}: {
  searchParams: Promise<{ canceled?: string }>;
}) {
  const { canceled } = await searchParams;
  const configured = isPaymentsConfigured();
  const t = (await getDictionary()).advertise.page;
  const [introBefore, introAfter] = aroundPlaceholder(t.intro, "price");

  return (
    <div className="mx-auto max-w-2xl px-4 py-14">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">
        {t.eyebrow}
      </p>
      <h1 className="font-display mt-2 text-3xl font-semibold tracking-tight">
        {t.title}
      </h1>
      <p className="mt-3 text-sm text-foreground-soft">
        {introBefore}
        <bdi>{formatCents(AD_PRICE_PER_DAY_CENTS)}</bdi>
        {introAfter}
      </p>

      {canceled && (
        <p role="alert" className="mt-6 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          {t.canceled}
        </p>
      )}

      <div className="mt-8">
        {configured ? (
          <AdBookingForm />
        ) : (
          <p className="rounded-xl border border-line p-5 text-sm text-foreground-soft">
            {t.notConfigured}
          </p>
        )}
      </div>
    </div>
  );
}
