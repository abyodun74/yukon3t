"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  signUpSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  adminDeleteUserSchema,
} from "@/lib/validations";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email";
import { issueSessionCookie } from "@/lib/session-token";
import { track } from "@/lib/analytics";
import { requireAdmin } from "@/lib/auth-guards";

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const LOCKOUT_THRESHOLD = 4;
const LOCKOUT_DURATION_MS = 24 * 60 * 60 * 1000;

async function clientIp() {
  return (await headers()).get("x-forwarded-for") ?? "unknown";
}

async function sendVerificationEmail(email: string) {
  const token = randomUUID();
  await prisma.verificationToken.deleteMany({ where: { identifier: email } });
  await prisma.verificationToken.create({
    data: { identifier: email, token, expires: new Date(Date.now() + VERIFY_TOKEN_TTL_MS) },
  });

  const url = `${process.env.NEXT_PUBLIC_APP_URL}/verify-email?token=${token}&email=${encodeURIComponent(email)}`;
  await sendEmail({
    to: email,
    subject: "Confirm your YuKon3t email",
    html: `<p>Confirm your email to finish creating your YuKon3t account.</p>
      <p><a href="${url}">Confirm email</a></p>
      <p>This link expires in 24 hours. If you didn't request this, ignore this email.</p>`,
  });
}

export async function signUpWithPassword(formData: FormData) {
  const ip = await clientIp();
  const allowed = await checkRateLimit("passwordSignUp", `signup:${ip}`);
  if (!allowed) {
    redirect("/sign-up?error=rate_limited");
  }

  const parsed = signUpSchema.safeParse({
    username: formData.get("username"),
    email: formData.get("email"),
    password: formData.get("password"),
    birthDate: formData.get("birthDate"),
  });

  if (!parsed.success) {
    const underage = parsed.error.issues.some((i) => i.path[0] === "birthDate");
    redirect(`/sign-up?error=${underage ? "underage" : "invalid"}`);
  }

  const { username, email, password, birthDate } = parsed.data;

  const [existingEmail, existingUsername] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
    prisma.user.findUnique({ where: { username }, select: { id: true } }),
  ]);
  if (existingEmail) {
    redirect("/sign-up?error=email_taken");
  }
  if (existingUsername) {
    redirect("/sign-up?error=username_taken");
  }

  const passwordHash = await hashPassword(password);
  const created = await prisma.user.create({
    data: { email, username, passwordHash, birthDate, status: "ACTIVE" },
  });
  await track("SIGN_UP", created.id, { method: "password" });

  await sendVerificationEmail(email);
  redirect("/sign-in/check-email?context=verify");
}

/**
 * Consumes the verification token — deliberately only reachable via a POST
 * form submit, never as a side effect of rendering the /verify-email page.
 * A bare GET link is routinely pre-fetched by corporate email "safe link"
 * scanners, which would otherwise burn the one-time token before the real
 * user ever clicks it.
 */
export async function confirmEmailVerification(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!token || !email) {
    redirect("/verify-email");
  }

  const record = await prisma.verificationToken.findUnique({
    where: { identifier_token: { identifier: email, token } },
  });
  if (!record || record.expires < new Date()) {
    redirect(`/verify-email?email=${encodeURIComponent(email)}`);
  }

  await prisma.user.update({ where: { email }, data: { emailVerified: new Date() } });
  await prisma.verificationToken.delete({ where: { identifier_token: { identifier: email, token } } });

  redirect("/verify-email?verified=1");
}

export async function resendVerificationEmail(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return;

  const ip = await clientIp();
  const allowed = await checkRateLimit("passwordSignUp", `resend:${ip}:${email}`);
  if (!allowed) return;

  const user = await prisma.user.findUnique({ where: { email }, select: { emailVerified: true } });
  if (user && !user.emailVerified) {
    await sendVerificationEmail(email);
  }
  redirect("/sign-in/check-email?context=verify");
}

export async function loginWithPassword(formData: FormData) {
  const ip = await clientIp();
  const parsed = loginSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    redirect("/sign-in?error=invalid_credentials");
  }
  const { identifier, password } = parsed.data;

  const allowed = await checkRateLimit("passwordLogin", `login:${ip}:${identifier.toLowerCase()}`);
  if (!allowed) {
    redirect("/sign-in?error=rate_limited");
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: identifier.toLowerCase() }, { username: identifier }],
    },
  });

  if (!user || !user.passwordHash) {
    redirect("/sign-in?error=invalid_credentials");
  }
  if (user.status !== "ACTIVE" && user.status !== "DEACTIVATED") {
    redirect("/sign-in?error=invalid_credentials");
  }

  // Brute-force lockout, separate from (and stricter than) the IP-scoped
  // passwordLogin rate limit above — this one is per-account and survives
  // the attacker switching IPs. Checked before verifying the password so a
  // locked account can't be probed at all during the lockout window.
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    redirect("/sign-in?error=locked");
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const attempts = user.failedLoginAttempts + 1;
    const lockingNow = attempts >= LOCKOUT_THRESHOLD;
    await prisma.user.update({
      where: { id: user.id },
      data: lockingNow
        ? { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) }
        : { failedLoginAttempts: attempts },
    });
    redirect(`/sign-in?error=${lockingNow ? "locked" : "invalid_credentials"}`);
  }
  if (!user.emailVerified) {
    redirect(`/sign-in?error=unverified&email=${encodeURIComponent(user.email)}`);
  }

  // Logging back in with the right password is treated as an explicit
  // request to reactivate — same "log in to come back" pattern most social
  // apps use, rather than a separate reactivation flow. Also clears any
  // stale lockout bookkeeping now that the real password has been proven.
  if (user.status === "DEACTIVATED" || user.failedLoginAttempts > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        status: "ACTIVE",
        deactivatedAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
  }

  await issueSessionCookie(user);
  await track("SIGN_IN", user.id, { method: "password" });

  redirect("/home");
}

/**
 * Always redirects to the same "check your email" page regardless of
 * whether the address is registered — otherwise this endpoint becomes an
 * account-enumeration oracle.
 */
export async function requestPasswordReset(formData: FormData) {
  const ip = await clientIp();
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    redirect("/forgot-password?error=invalid");
  }
  const { email } = parsed.data;

  const allowed = await checkRateLimit("passwordResetRequest", `resetreq:${ip}:${email}`);
  if (!allowed) {
    redirect("/forgot-password?sent=1");
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, status: true } });
  if (user && user.status === "ACTIVE") {
    const token = randomUUID();
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await prisma.passwordResetToken.create({
      data: { userId: user.id, token, expires: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
    });

    const url = `${process.env.NEXT_PUBLIC_APP_URL}/reset-password?token=${token}`;
    await sendEmail({
      to: email,
      subject: "Reset your YuKon3t password",
      html: `<p>Someone requested a password reset for this YuKon3t account.</p>
        <p><a href="${url}">Reset your password</a></p>
        <p>This link expires in 1 hour. If you didn't request this, ignore this email — your password won't change.</p>`,
    });
  }

  redirect("/forgot-password?sent=1");
}

export async function resetPassword(formData: FormData) {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    redirect(`/reset-password?token=${formData.get("token") ?? ""}&error=invalid`);
  }
  const { token, password } = parsed.data;

  const resetToken = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!resetToken || resetToken.expires < new Date()) {
    redirect("/forgot-password?error=expired");
  }

  const passwordHash = await hashPassword(password);
  await prisma.user.update({
    where: { id: resetToken.userId },
    // A password reset ends every existing session — otherwise a stolen
    // session token would survive the very recovery meant to cut it off.
    // Sessions are stateless JWTs (no server-side row to delete), so this
    // works by marking anything issued before now as stale; requireUser()
    // checks each session's issued-at time against this on every request.
    // Completing a reset is proof of email ownership, so it also clears any
    // brute-force lockout immediately rather than making the real owner
    // wait out the 24h — this is the intended early-unlock path.
    data: {
      passwordHash,
      sessionInvalidatedAt: new Date(),
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });
  await prisma.passwordResetToken.deleteMany({ where: { userId: resetToken.userId } });

  redirect("/sign-in?reset=1");
}

/**
 * Admin-initiated password reset — for support cases where a customer can't
 * complete their own reset (e.g. they don't recognize the "email already in
 * use" they get on sign-up because they'd forgotten they already had an
 * account) or is locked out and doesn't want to wait 24h. Uses the exact
 * same token/expiry as the self-service flow, so completing it also clears
 * the lockout via resetPassword above — this one action covers both cases.
 * Not IP-rate-limited like requestPasswordReset: the trust boundary here is
 * admin auth itself, not anonymous request volume.
 */
export async function adminSendPasswordReset(userId: string) {
  const admin = await requireAdmin();

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return { error: "not_found" as const };
  }

  const token = randomUUID();
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
  await prisma.passwordResetToken.create({
    data: { userId: user.id, token, expires: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
  });

  const url = `${process.env.NEXT_PUBLIC_APP_URL}/reset-password?token=${token}`;
  await sendEmail({
    to: user.email,
    subject: "Reset your YuKon3t password",
    html: `<p>A YuKon3t admin sent you this link after you contacted support about signing in.</p>
      <p><a href="${url}">Reset your password</a></p>
      <p>This link expires in 1 hour. If you didn't contact support about this, ignore this email — your password won't change.</p>`,
  });

  await prisma.auditLog.create({
    data: {
      targetId: user.id,
      action: "PASSWORD_RESET_SENT",
      reason: `Password reset link sent to ${user.email} by admin at their request.`,
      performedBy: admin.id,
    },
  });

  revalidatePath("/admin/users");
  return { error: null, email: user.email };
}

/**
 * Admin-initiated hard delete — the only way to actually remove another
 * account's data (BAN via the moderation queue only hides/disables it,
 * never deletes anything). Reuses the exact same prisma.user.delete() +
 * onDelete: Cascade relations already proven safe by the self-service
 * deleteMyAccount below, just gated behind admin auth with extra friction
 * since one admin mistake here can destroy someone else's real data:
 * typed-handle confirmation, a required reason, and a hard block on
 * deleting yourself or another admin (avoids both accidental lockout and
 * one admin being able to unilaterally remove another).
 *
 * The AuditLog write pattern used elsewhere doesn't work here — AuditLog
 * rows are FK'd to their target user with onDelete: Cascade, so a normal
 * audit entry would vanish the instant the user is deleted, erasing the
 * only record of why. AccountDeletionLog deliberately has no such relation
 * (plain string fields) so it survives.
 */
export async function adminDeleteUser(formData: FormData) {
  const admin = await requireAdmin();

  const parsed = adminDeleteUserSchema.safeParse({
    userId: formData.get("userId"),
    confirmHandle: formData.get("confirmHandle"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const { userId, confirmHandle, reason } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return { error: "not_found" as const };
  }
  if (user.id === admin.id) {
    return { error: "cannot_delete_self" as const };
  }
  if (user.isAdmin) {
    return { error: "cannot_delete_admin" as const };
  }
  const expectedHandle = user.username ?? user.email;
  if (confirmHandle !== expectedHandle) {
    return { error: "confirmation_mismatch" as const };
  }

  await prisma.accountDeletionLog.create({
    data: {
      deletedUserId: user.id,
      deletedEmail: user.email,
      deletedUsername: user.username,
      reason,
      performedBy: admin.id,
    },
  });
  await prisma.user.delete({ where: { id: user.id } });

  revalidatePath("/admin/users");
  return { error: null };
}
