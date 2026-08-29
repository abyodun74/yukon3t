import Link from "next/link";
import { readPendingVerification } from "@/lib/pending-verification";
import { prisma } from "@/lib/prisma";
import { SignupPhoneVerificationForm } from "@/components/signup-phone-verification-form";

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
    </div>
  );
}
