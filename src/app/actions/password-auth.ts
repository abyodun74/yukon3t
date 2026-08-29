"use server";

import { randomUUID } from "node:crypto";
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
import { STUCK_UNVERIFIED_AFTER_MS } from "@/lib/login-issues";
import { getClientIp as clientIp } from "@/lib/client-ip";
import { generateOtpCode, hashOtpCode, EMAIL_OTP_TTL_MS, EMAIL_OTP_MAX_ATTEMPTS } from "@/lib/otp";
import {
  issuePendingVerificationCookie,
  readPendingVerification,
  clearPendingVerificationCookie,
} from "@/lib/pending-verification";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const LOCKOUT_THRESHOLD = 4;
const LOCKOUT_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * Sign-up no longer collects a username up front (just email + password +
 * birth date) — this derives one from the email's local part so every user
 * still has the unique handle the rest of the app (profile links, mentions,
 * search) depends on. They can pick a custom one later in Settings, same as
 * magic-link-only accounts already do.
 */
async function generateUniqueUsername(email: string) {
  const base = email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "").slice(0, 15) || "user";
  const padded = base.length < 3 ? base.padEnd(3, "0") : base;

  for (let attempt = 0; attempt < 10; attempt++) {
    const suffix = attempt === 0 ? "" : String(Math.floor(1000 + Math.random() * 9000));
    const candidate = `${padded}${suffix}`.slice(0, 20);
    const existing = await prisma.user.findUnique({ where: { username: candidate }, select: { id: true } });
    if (!existing) return candidate;
  }

  return `user${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

async function sendEmailOtp(userId: string, email: string) {
  const code = generateOtpCode();
  await prisma.user.update({
    where: { id: userId },
    data: {
      emailOtpCodeHash: hashOtpCode(code),
      emailOtpExpires: new Date(Date.now() + EMAIL_OTP_TTL_MS),
      emailOtpAttempts: 0,
    },
  });

  await sendEmail({
    to: email,
    subject: "Your YuKon3t verification code",
    html: `<p>Your YuKon3t verification code is:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:4px;">${code}</p>
      <p>This code expires in 10 minutes. If you didn't request this, ignore this email.</p>`,
  });
}

/**
 * Called from the /verify-email page on every load — if the current code is
 * missing or has expired, silently sends a fresh one (rate-limit-gated, so
 * repeated page loads can't be abused to spam mail) instead of waiting for
 * the user to click "Resend code". This is the "automatic resend when stuck"
 * behavior for the email verification path.
 */
export async function ensureFreshEmailOtp(userId: string, email: string, expires: Date | null) {
  if (expires && expires > new Date()) return;
  const allowed = await checkRateLimit("emailOtpSend", `otpsend:auto:${userId}`);
  if (!allowed) return;
  await sendEmailOtp(userId, email);
}

export async function signUpWithPassword(formData: FormData) {
  const ip = await clientIp();
  const allowed = await checkRateLimit("passwordSignUp", `signup:${ip}`);
  if (!allowed) {
    redirect("/sign-up?error=rate_limited");
  }

  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    birthDate: formData.get("birthDate"),
    verificationMethod: formData.get("verificationMethod"),
  });

  if (!parsed.success) {
    const underage = parsed.error.issues.some((i) => i.path[0] === "birthDate");
    redirect(`/sign-up?error=${underage ? "underage" : "invalid"}`);
  }

  const { email, password, birthDate, verificationMethod } = parsed.data;

  const existingEmail = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existingEmail) {
    redirect("/sign-up?error=email_taken");
  }

  const username = await generateUniqueUsername(email);
  const passwordHash = await hashPassword(password);
  const created = await prisma.user.create({
    data: { email, username, passwordHash, birthDate, status: "ACTIVE", pendingVerificationMethod: verificationMethod },
  });
  await track("SIGN_UP", created.id, { method: "password" });

  if (verificationMethod === "PHONE") {
    await issuePendingVerificationCookie(created.id);
    redirect("/sign-up/verify-phone");
  }

  await sendEmailOtp(created.id, email);
  await issuePendingVerificationCookie(created.id);
  redirect("/verify-email");
}

export async function confirmEmailOtp(formData: FormData) {
  const pending = await readPendingVerification();
  if (!pending) {
    redirect("/sign-in");
  }
  const { userId } = pending;

  const ip = await clientIp();
  const allowed = await checkRateLimit("emailOtpCheck", `otpcheck:${ip}:${userId}`);
  if (!allowed) {
    redirect("/verify-email?error=rate_limited");
  }

  const code = String(formData.get("code") ?? "").trim();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.emailOtpCodeHash || !user.emailOtpExpires) {
    redirect("/verify-email?error=expired");
  }
  if (user.emailOtpExpires < new Date()) {
    redirect("/verify-email?error=expired");
  }
  if (user.emailOtpAttempts >= EMAIL_OTP_MAX_ATTEMPTS) {
    redirect("/verify-email?error=too_many_attempts");
  }

  if (hashOtpCode(code) !== user.emailOtpCodeHash) {
    await prisma.user.update({ where: { id: userId }, data: { emailOtpAttempts: { increment: 1 } } });
    redirect("/verify-email?error=invalid_code");
  }

  const now = new Date();
  // Only a genuine moderation-queue resolution if the account was actually
  // old enough to have been flagged "stuck" there in the first place —
  // otherwise every ordinary signup verifying within minutes would show up
  // under "recently resolved" despite never having been a visible problem.
  const wasStuck = now.getTime() - user.createdAt.getTime() > STUCK_UNVERIFIED_AFTER_MS;

  await prisma.user.update({
    where: { id: userId },
    data: {
      emailVerified: now,
      emailOtpCodeHash: null,
      emailOtpExpires: null,
      emailOtpAttempts: 0,
      pendingVerificationMethod: null,
      ...(wasStuck ? { loginIssueResolvedAt: now } : {}),
    },
  });
  await clearPendingVerificationCookie();

  redirect("/verify-email?verified=1");
}

/**
 * Called both from /verify-email's "Resend code" button (has the
 * pending-verification cookie from the same signup) and from /sign-in's
 * "Resend confirmation code" link when login was blocked as unverified —
 * that second case may be a different browser/device with no cookie, so it
 * falls back to the submitted email, same as the old link-based resend did.
 * Always redirects to the same page regardless of whether the email is
 * registered, to avoid becoming an account-enumeration oracle (same
 * reasoning as requestPasswordReset below).
 */
export async function resendEmailOtp(formData: FormData) {
  const ip = await clientIp();
  const pending = await readPendingVerification();

  if (!pending) {
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    if (!email) {
      redirect("/sign-in");
    }
    const allowed = await checkRateLimit("emailOtpSend", `otpsend:${ip}:${email}`);
    if (allowed) {
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true, emailVerified: true } });
      if (user && !user.emailVerified) {
        await sendEmailOtp(user.id, email);
        await issuePendingVerificationCookie(user.id);
      }
    }
    // Always land on the same static page regardless of whether the email
    // was registered — /verify-email's rendering branches on the pending-
    // verification cookie, which would otherwise turn this into an
    // account-enumeration oracle.
    redirect("/sign-in/check-email?context=verify");
  }

  const { userId } = pending;
  const allowed = await checkRateLimit("emailOtpSend", `otpsend:${ip}:${userId}`);
  if (!allowed) {
    redirect("/verify-email?error=rate_limited");
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerified: true } });
  if (user && !user.emailVerified) {
    await sendEmailOtp(userId, user.email);
  }
  redirect("/verify-email?sent=1");
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
    // failedLoginAt anchors "how long has this been unresolved" for the
    // resolve-login-issues cron (src/app/api/cron/resolve-login-issues) —
    // only set on the first attempt in a fresh window, same as
    // failedLoginAttempts itself only starting to count from 0 there.
    await prisma.user.update({
      where: { id: user.id },
      data: lockingNow
        ? { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS), failedLoginAt: null }
        : { failedLoginAttempts: attempts, failedLoginAt: user.failedLoginAttempts === 0 ? new Date() : undefined },
    });
    redirect(`/sign-in?error=${lockingNow ? "locked" : "invalid_credentials"}`);
  }
  if (!user.emailVerified && !user.phoneVerifiedAt) {
    redirect(`/sign-in?error=unverified&email=${encodeURIComponent(user.email)}`);
  }

  // Logging back in with the right password is treated as an explicit
  // request to reactivate — same "log in to come back" pattern most social
  // apps use, rather than a separate reactivation flow. Also clears any
  // stale lockout bookkeeping now that the real password has been proven.
  const hadLoginIssue = user.failedLoginAttempts > 0 || !!user.lockedUntil;
  if (user.status === "DEACTIVATED" || hadLoginIssue) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        status: "ACTIVE",
        deactivatedAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
        failedLoginAt: null,
        ...(hadLoginIssue ? { loginIssueResolvedAt: new Date() } : {}),
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

  const target = await prisma.user.findUnique({
    where: { id: resetToken.userId },
    select: { failedLoginAttempts: true, lockedUntil: true },
  });
  const hadLoginIssue = !!target && (target.failedLoginAttempts > 0 || !!target.lockedUntil);

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
      failedLoginAt: null,
      ...(hadLoginIssue ? { loginIssueResolvedAt: new Date() } : {}),
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
  revalidatePath("/admin/moderation");
  return { error: null, email: user.email };
}

/**
 * Admin-initiated resend of the sign-up confirmation code — for a customer
 * stuck on "confirm your email before signing in" who lost or never
 * received the original (spam filter, mistyped address they've since fixed,
 * etc). Same OTP mechanism as the self-service resend in resendEmailOtp
 * above, just admin-triggered and not gated behind that flow's per-IP rate
 * limit, since admin auth is the trust boundary here — mirrors
 * adminSendPasswordReset's reasoning exactly.
 */
export async function adminResendVerificationEmail(userId: string) {
  const admin = await requireAdmin();

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return { error: "not_found" as const };
  }
  if (user.emailVerified) {
    return { error: "already_verified" as const };
  }

  await sendEmailOtp(user.id, user.email);

  await prisma.auditLog.create({
    data: {
      targetId: user.id,
      action: "VERIFICATION_EMAIL_SENT",
      reason: `Confirmation email re-sent to ${user.email} by admin — account was stuck unverified.`,
      performedBy: admin.id,
    },
  });

  revalidatePath("/admin/users");
  revalidatePath("/admin/moderation");
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
