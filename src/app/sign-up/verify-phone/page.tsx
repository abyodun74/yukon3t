import Link from "next/link";
import { readPendingVerification } from "@/lib/pending-verification";
import { prisma } from "@/lib/prisma";
import { SignupPhoneVerificationForm } from "@/components/signup-phone-verification-form";
import { SubmitButton } from "@/components/submit-button";
import { switchToEmailVerification } from "@/app/actions/password-auth";

export default async function VerifyPhonePage() {
  const pending = await readPendingVerification();
  if (!pending) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">Nothing to verify here</h1>
        <p className="mt-3 text-sm text-foreground-soft">
          This link has expired or was opened on a different device.
        </p>
        <Link href="/sign-in" className="mt-6 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink">
          Sign in
        </Link>
      </div>
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: pending.userId },
    select: { phoneVerifiedAt: true },
  });
  if (user?.phoneVerifiedAt) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">Already verified</h1>
        <Link href="/sign-in" className="mt-6 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
      <h1 className="text-2xl font-semibold">Verify your phone</h1>
      <p className="mt-2 text-center text-sm text-foreground-soft">
        Enter your phone number and we&apos;ll text you a code to confirm
        your account.
      </p>
      <div className="mt-6 w-full">
        <SignupPhoneVerificationForm initialPhone={pending.phone ?? null} />
      </div>

      {/* A text can be slow or blocked too — always offer the other way in. */}
      <form action={switchToEmailVerification} className="mt-8 w-full border-t border-line pt-5 text-center">
        <p className="text-sm font-medium">Not getting the text?</p>
        <p className="mt-1 text-xs text-foreground-soft">We can send the code to your email instead.</p>
        <SubmitButton
          label="Use email code instead"
          pendingLabel="Switching..."
          className="mt-3 rounded-lg border border-line px-4 py-2.5 text-sm font-medium hover:border-accent hover:text-accent"
        />
      </form>
    </div>
  );
}
