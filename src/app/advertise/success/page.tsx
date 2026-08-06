import Link from "next/link";

export default async function AdvertiseSuccessPage() {
  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent">Payment received</p>
      <h1 className="font-display mt-2 text-2xl font-semibold">Thanks — your ad is booked.</h1>
      <p className="mt-3 text-sm text-foreground-soft">
        We&apos;ll review your creative shortly (usually within one business day) before it goes
        live. You&apos;ll be able to reach us at the contact email you provided if we have any
        questions.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-ink"
      >
        Back to YuKon3t
      </Link>
    </div>
  );
}
