// One-off: diagnoses and fixes (or creates, if missing) an App Store review
// demo account (the one whose username/password go in App Store Connect's
// demo-account field, or a second one reviewers message). Apple's reviewer
// signs in from a device/network this app has never seen and from a mailbox
// they can't read — the account needs isAppReviewDemo set so
// loginWithPassword/auth.ts's signIn callback skip the email/phone
// verification gate and the new-device emailed-code challenge for it (see
// those files). This script also prints/clears anything else that could
// independently block a sign-in (account status, lockout, verification).
//
// Prefer the admin "Fix demo accounts" button (/admin): it runs against the
// production database by construction. This script needs DATABASE_URL
// pointed at production (Neon), not local dev.
//
// The password is never a command-line argument (it would land in shell
// history) and never in this repository. With --reset-password it is read
// from APP_REVIEW_DEMO_PASSWORD in the environment or, if that is unset,
// typed at a hidden prompt. It must be at least 16 characters, and it must
// equal APP_REVIEW_DEMO_PASSWORD on Netlify and Vercel, or the deployed app
// refuses the demo sign-in (src/lib/app-review-demo.ts).
//
//   npx tsx scripts/fix-app-review-demo-account.ts <username>
//   npx tsx scripts/fix-app-review-demo-account.ts <username> --reset-password
//   npx tsx scripts/fix-app-review-demo-account.ts <username> --email="..." --reset-password   (creates if missing)
//
// Safe to re-run.

import "dotenv/config";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/passwords";
import { APP_REVIEW_DEMO_MIN_PASSWORD_LENGTH, appReviewDemoPassword } from "@/lib/app-review-demo";
import { clearAllLoginFailures } from "@/lib/login-lockout-server";

function flag(args: string[], name: string): string | undefined {
  const match = args.find((a) => a.startsWith(`--${name}=`));
  return match?.slice(`--${name}=`.length);
}

/** Reads a line from the terminal without echoing it. */
async function promptHidden(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding as BufferEncoding);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  const answer = new Promise<string>((resolve) => rl.question(question, resolve));
  muted = true;
  const value = await answer;
  rl.close();
  process.stdout.write("\n");
  return value;
}

async function readDemoPassword(): Promise<string> {
  const fromEnv = appReviewDemoPassword();
  if (fromEnv) return fromEnv;
  if (process.env.APP_REVIEW_DEMO_PASSWORD) {
    console.error(`APP_REVIEW_DEMO_PASSWORD is shorter than ${APP_REVIEW_DEMO_MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }
  const typed = await promptHidden("Demo account password (input hidden): ");
  if (typed.length < APP_REVIEW_DEMO_MIN_PASSWORD_LENGTH) {
    console.error(`The password must be at least ${APP_REVIEW_DEMO_MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }
  return typed;
}

async function main() {
  const [identifier, ...rest] = process.argv.slice(2);
  if (!identifier) {
    console.error('Usage: npx tsx scripts/fix-app-review-demo-account.ts <username> [--email="..."] [--reset-password]');
    process.exit(1);
  }
  if (rest.some((a) => a.startsWith("--reset-password="))) {
    console.error("Don't pass the password on the command line: use --reset-password and APP_REVIEW_DEMO_PASSWORD or the prompt.");
    process.exit(1);
  }
  const resetPassword = rest.includes("--reset-password");
  const email = flag(rest, "email");

  const user = await prisma.user.findFirst({
    where: { OR: [{ username: { equals: identifier, mode: "insensitive" } }, { email: identifier.toLowerCase() }] },
    omit: { passwordHash: false },
  });

  if (!user) {
    if (!email || !resetPassword) {
      console.error(`No user found matching "${identifier}" — creating one requires both --email="..." and --reset-password.`);
      process.exit(1);
    }
    const created = await prisma.user.create({
      data: {
        username: identifier,
        email: email.toLowerCase(),
        passwordHash: await hashPassword(await readDemoPassword()),
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

  const passwordData = resetPassword
    ? {
        passwordHash: await hashPassword(await readDemoPassword()),
        passwordResetRequiredAt: null,
        sessionInvalidatedAt: new Date(),
      }
    : {};
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
      ...passwordData,
    },
  });
  await clearAllLoginFailures(user.id);

  console.log(
    resetPassword
      ? "Fixed: isAppReviewDemo set, status/lockout/verification cleared, password set to the configured value."
      : "Fixed: isAppReviewDemo set, status/lockout/verification cleared. Password left unchanged — pass --reset-password to also set it.",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
