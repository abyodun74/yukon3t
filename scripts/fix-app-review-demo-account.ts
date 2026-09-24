// One-off: diagnoses and fixes (or creates, if missing) the account whose
// username/password go in App Store Connect's demo-account field. Apple's
// reviewer signs in from a device/network this app has never seen and from
// a mailbox they can't read — this account needs isAppReviewDemo set so
// loginWithPassword/auth.ts's signIn callback skip the email/phone
// verification gate and the new-device emailed-code challenge for it (see
// those files). This script also prints/clears anything else that could
// independently block a sign-in (account status, lockout, verification) —
// and, first confirmed live 2026-09-24, handles the account not existing in
// production at all yet (created only locally, or never actually created).
//
// Run against PRODUCTION (point DATABASE_URL at Neon, not local dev):
//   npx tsx scripts/fix-app-review-demo-account.ts abiodunapplereview
//
// To also reset the password to a known value in the same run (useful if
// Apple's rejection could be a simple typo in App Store Connect rather than
// a gate — this makes both possible causes moot in one pass):
//   npx tsx scripts/fix-app-review-demo-account.ts abiodunapplereview --reset-password="NewStrongPass123!"
//
// If no account matches, this creates one — --email is then required (the
// password comes from --reset-password too, and is required in create mode
// since a passwordless account is useless for this purpose):
//   npx tsx scripts/fix-app-review-demo-account.ts abiodunapplereview --email="appreview@yukon3t.com" --reset-password="AppReview001"
//
// Safe to re-run.

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/passwords";

function flag(args: string[], name: string): string | undefined {
  const match = args.find((a) => a.startsWith(`--${name}=`));
  return match?.slice(`--${name}=`.length);
}

async function main() {
  const [identifier, ...rest] = process.argv.slice(2);
  if (!identifier) {
    console.error(
      'Usage: npx tsx scripts/fix-app-review-demo-account.ts <username> [--email="..."] [--reset-password="..."]',
    );
    process.exit(1);
  }
  const newPassword = flag(rest, "reset-password");
  const email = flag(rest, "email");

  const user = await prisma.user.findFirst({
    where: { OR: [{ username: { equals: identifier, mode: "insensitive" } }, { email: identifier.toLowerCase() }] },
  });

  if (!user) {
    if (!email || !newPassword) {
      console.error(
        `No user found matching "${identifier}" — creating one requires both --email="..." and --reset-password="...".`,
      );
      process.exit(1);
    }
    const created = await prisma.user.create({
      data: {
        username: identifier,
        email: email.toLowerCase(),
        passwordHash: await hashPassword(newPassword),
        // Any adult date works — this account never goes through the real
        // signup age-gate, and nothing else reads birthDate for it.
        birthDate: new Date("1995-01-01"),
        status: "ACTIVE",
        emailVerified: new Date(),
        isAppReviewDemo: true,
      },
    });
    console.log("Created:", { id: created.id, username: created.username, email: created.email });
    console.log("Done — this account bypasses email/phone verification and the new-device challenge (isAppReviewDemo).");
    return;
  }

  console.log("Before:", {
    id: user.id,
    username: user.username,
    email: user.email,
    status: user.status,
    emailVerified: user.emailVerified,
    phoneVerifiedAt: user.phoneVerifiedAt,
    lockedUntil: user.lockedUntil,
    failedLoginAttempts: user.failedLoginAttempts,
    isAppReviewDemo: user.isAppReviewDemo,
    hasPasswordHash: Boolean(user.passwordHash),
  });

  await prisma.user.update({
    where: { id: user.id },
    data: {
      isAppReviewDemo: true,
      status: "ACTIVE",
      deactivatedAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      failedLoginAt: null,
      emailVerified: user.emailVerified ?? new Date(),
      ...(newPassword ? { passwordHash: await hashPassword(newPassword) } : {}),
    },
  });

  console.log(
    newPassword
      ? "Fixed: isAppReviewDemo set, status/lockout/verification cleared, password reset to the value you passed."
      : "Fixed: isAppReviewDemo set, status/lockout/verification cleared. Password left unchanged — pass --reset-password=\"...\" to also reset it.",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
