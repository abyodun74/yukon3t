import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Eye, Lock, Timer } from "lucide-react";
import { auth } from "@/lib/auth";
import { startGuestPreview } from "@/app/actions/guest-preview";
import { SubmitButton } from "@/components/submit-button";
import { BotProtectionFields } from "@/components/bot-protection-fields";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { LanguagePicker } from "@/components/language-picker";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { isGuestPreviewEnabled, sanitizeGuestRef } from "@/lib/guest-preview";

// "Explore YuKon3t as a guest": the no-sign-up link (e.g. https://yukon3t.com/try?ref=reddit). Rules and the threat
// model: src/lib/guest-preview.ts. 404 unless GUEST_PREVIEW_ENABLED=1. Never indexed.
export const metadata: Metadata = {
  title: "Explore as a guest",
  robots: { index: false, follow: false },
};

const ERROR_KEYS = ["unavailable", "rate_limited", "captcha", "captcha_unavailable"] as const;

export default async function TryPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; error?: string }>;
}) {
  if (!isGuestPreviewEnabled()) notFound();
  const session = await auth();
  // A member, or a guest whose visit is still running, goes straight in.
  if (session?.user?.id) redirect("/home");

  const { ref: rawRef, error } = await searchParams;
  const ref = sanitizeGuestRef(rawRef);
  const locale = await getLocale();
  const t = await getDictionary();
  const g = t.shell.guest.try;
  const errorKey = ERROR_KEYS.find((k) => k === error);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
      <h1 className="text-center text-2xl font-semibold">{g.title}</h1>
      <p className="mt-2 text-center text-sm text-foreground-soft">{g.intro}</p>

      <ul className="mt-6 w-full space-y-3 rounded-xl border border-line bg-surface p-4 text-sm">
        <li className="flex items-start gap-3">
          <Eye className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
          <span>{g.canDo}</span>
        </li>
        <li className="flex items-start gap-3">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
          <span>{g.cantDo}</span>
        </li>
        <li className="flex items-start gap-3">
          <Timer className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
          <span>{g.expires}</span>
        </li>
      </ul>

      {errorKey && (
        <p role="alert" className="mt-4 w-full rounded-lg bg-danger/10 px-4 py-2 text-center text-sm text-danger">
          {g.errors[errorKey]}
        </p>
      )}

      <form action={startGuestPreview} className="mt-6 w-full space-y-3" data-guest-ok>
        <BotProtectionFields />
        {ref && <input type="hidden" name="ref" value={ref} />}
        <TurnstileWidget locale={locale} strings={t.shared.turnstile} />
        <SubmitButton
          label={g.button}
          pendingLabel={g.pending}
          offlineMessage={t.shared.submitButton.offline}
          className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
        />
      </form>

      <p className="mt-6 text-center text-sm text-foreground-soft">
        <Link href="/sign-up" className="font-medium text-accent hover:underline">
          {g.orSignUp}
        </Link>
        <span aria-hidden> · </span>
        {g.haveAccount}{" "}
        <Link href="/sign-in" className="font-medium text-accent hover:underline">
          {t.shell.guest.signIn}
        </Link>
      </p>

      <LanguagePicker locale={locale} label={t.languagePicker.label} />
    </div>
  );
}
