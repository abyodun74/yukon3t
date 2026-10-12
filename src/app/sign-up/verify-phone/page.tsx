import Link from "next/link";
import { readPendingVerification } from "@/lib/pending-verification";
import { prisma } from "@/lib/prisma";
import { SignupPhoneVerificationForm } from "@/components/signup-phone-verification-form";
import { SubmitButton } from "@/components/submit-button";
import { getRequestCountry } from "@/lib/request-country";
import { switchToEmailVerification } from "@/app/actions/password-auth";
import { LanguagePicker } from "@/components/language-picker";
import { getDictionary, getLocale } from "@/lib/i18n/server";

export default async function VerifyPhonePage() {
  const locale = await getLocale();
  const t = await getDictionary();
  const picker = <LanguagePicker locale={locale} label={t.languagePicker.label} />;

  const pending = await readPendingVerification();
  if (!pending) {
    return (
      <div lang={locale} className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">{t.common.nothingToVerify}</h1>
        <p className="mt-3 text-sm text-foreground-soft">{t.verifyPhone.expiredBody}</p>
        <Link href="/sign-in" className="mt-6 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink">
          {t.common.signIn}
        </Link>
        {picker}
      </div>
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: pending.userId },
    select: { phoneVerifiedAt: true },
  });
  if (user?.phoneVerifiedAt) {
    return (
      <div lang={locale} className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">{t.common.alreadyVerified}</h1>
        <Link href="/sign-in" className="mt-6 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink">
          {t.common.signIn}
        </Link>
        {picker}
      </div>
    );
  }

  return (
    <div lang={locale} className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
      <h1 className="text-2xl font-semibold">{t.verifyPhone.title}</h1>
      <p className="mt-2 text-center text-sm text-foreground-soft">{t.verifyPhone.intro}</p>
      <div className="mt-6 w-full">
        <SignupPhoneVerificationForm
          initialPhone={pending.phone ?? null}
          defaultCountry={await getRequestCountry()}
          locale={locale}
          t={t.verifyPhone.form}
          shared={t.shared}
        />
      </div>

      {/* A text can be slow or blocked too — always offer the other way in. */}
      <form action={switchToEmailVerification} className="mt-8 w-full border-t border-line pt-5 text-center">
        <p className="text-sm font-medium">{t.verifyPhone.noText}</p>
        <p className="mt-1 text-xs text-foreground-soft">{t.verifyPhone.emailInstead}</p>
        <SubmitButton
          label={t.verifyPhone.useEmail}
          pendingLabel={t.common.switching}
          offlineMessage={t.shared.submitButton.offline}
          className="mt-3 rounded-lg border border-line px-4 py-2.5 text-sm font-medium hover:border-accent hover:text-accent"
        />
      </form>

      {picker}
    </div>
  );
}
