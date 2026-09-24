// One-off: diagnoses and fixes the account whose username/password go in
// App Store Connect's demo-account field (currently "abiodunapplereview").
// Apple's reviewer signs in from a device/network this app has never seen
// and from a mailbox they can't read — this account needs isAppReviewDemo
// set so loginWithPassword/auth.ts's signIn callback skip the email/phone
// verification gate and the new-device emailed-code challenge for it (see
// those files). This script also prints/clears anything else that could
// independently block a sign-in (account status, lockout, verification).
//
// Run against PRODUCTION (point DATABASE_URL at Neon, not local dev):
//   npx tsx scripts/fix-app-review-demo-account.ts abiodunapplereview
//
// To also reset the password to a known value in the same run (useful if
// Apple's rejection could be a simple typo in App Store Connect rather than
// a gate — this makes both possible causes moot in one pass):
//   npx tsx scripts/fix-app-review-demo-account.ts abiodunapplereview --reset-password="NewStrongPass123!"
//
// Safe to re-run.

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/passwords";

async function main() {
  const [identifier, ...rest] = process.argv.slice(2);
  if (!identifier) {
    console.error("Usage: npx tsx scripts/fix-app-review-demo-account.ts <username-or-email> [--reset-password=\"...\"]");
    process.exit(1);
  }
  const resetFlag = rest.find((a) => a.startsWith("--reset-password="));
  const newPassword = resetFlag?.slice("--reset-password=".length);

  const user = await prisma.user.findFirst({
    where: { OR: [{ username: { equals: identifier, mode: "insensitive" } }, { email: identifier.toLowerCase() }] },
  });
  if (!user) {
    console.error(`No user found matching "${identifier}".`);
    process.exit(1);
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
