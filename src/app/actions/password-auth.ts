"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { activeWidgetTokensOf } from "@/lib/ambient-access";
import { collectAccountMedia, deleteAccountMedia } from "@/lib/account-media";
import {
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  adminDeleteUserSchema,
} from "@/lib/validations";
import { validPhoneSchema } from "@/lib/phone-number";
import { validateSignUp, withTakenErrors, type SignUpState } from "@/lib/sign-up-form";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import { passwordSignInOutcome } from "@/lib/password-sign-in";
import { checkRateLimit } from "@/lib/rate-limit";
import { isBotSubmission } from "@/lib/bot-protection";
import { passesBotGate } from "@/lib/bot-gate";
import { captchaErrorCode } from "@/lib/turnstile-shared";
import { sendEmail } from "@/lib/email";
import { passwordResetEmail, verificationCodeEmail } from "@/lib/account-emails";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locales";
import { getLocale } from "@/lib/i18n/server";
import { issueSessionCookie } from "@/lib/session-token";
import { rememberLocale } from "@/lib/user-locale";
import { track } from "@/lib/analytics";
import { requireAdmin } from "@/lib/auth-guards";
import { STUCK_UNVERIFIED_AFTER_MS } from "@/lib/login-issues";
import { getClientIp as clientIp } from "@/lib/client-ip";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { BIRTHDAY_DEFAULT_AUDIENCE, birthdayNoticePendingAtSignUp } from "@/lib/birthdays";
import { generateOtpCode, hashOtpCode, EMAIL_OTP_TTL_MS, EMAIL_OTP_MAX_ATTEMPTS } from "@/lib/otp";
import {
  issuePendingVerificationCookie,
  readPendingVerification,
  clearPendingVerificationCookie,
} from "@/lib/pending-verification";
import { getDeviceId, getDeviceLabel } from "@/lib/device-id";
import { signInNeedsVerification } from "@/lib/account-verification";
import { evaluateDevice, trustDevice, touchKnownDevice } from "@/lib/device-trust";
import {
  createDeviceChallenge,
  verifyDeviceChallenge,
  issuePendingDeviceChallengeCookie,
  readPendingDeviceChallengeCookie,
  clearPendingDeviceChallengeCookie,
} from "@/lib/device-challenge";
import { generateResetToken, hashResetToken, resetPasswordUrl } from "@/lib/reset-token";
import { lockoutSourceKeys } from "@/lib/login-lockout";
import {
  clearAllLoginFailures,
  clearLoginFailures,
  isLoginLocked,
  recordLoginFailure,
  type LoginSubject,
} from "@/lib/login-lockout-server";
import {
  APP_REVIEW_DEMO_MIN_PASSWORD_LENGTH,
  appReviewDemoIdentity,
  appReviewDemoPassword,
  matchesAppReviewDemoPassword,
} from "@/lib/app-review-demo";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * Stores a fresh reset token for the account (only its SHA-256; any older link stops working) and returns the link
 * to email, which carries the token in the URL fragment (src/lib/reset-token.ts).
 */
async function issuePasswordResetLink(userId: string): Promise<string> {
  const token = generateResetToken();
  await prisma.passwordResetToken.deleteMany({ where: { userId } });
  await prisma.passwordResetToken.create({
    data: { userId, token: hashResetToken(token), expires: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
  });
  return resetPasswordUrl(process.env.NEXT_PUBLIC_APP_URL, token);
}

/**
 * Replaces any outstanding reset link for the account with a fresh one and emails it. "required" is the forced reset
 * (User.passwordResetRequiredAt), sent from loginWithPassword to someone who just typed the account's correct password.
 * Written in `locale`: the language of whoever is making the request.
 */
async function sendPasswordResetEmail(
  userId: string,
  email: string,
  reason: "requested" | "required",
  locale: Locale,
) {
  const url = await issuePasswordResetLink(userId);
  await sendEmail({ to: email, ...passwordResetEmail(locale, reason, url) });
}

// A real bcrypt hash of a random string, compared against when no usable account matched, so an unknown identifier
// takes as long to answer as a wrong password.
let dummyHash: Promise<string> | null = null;
function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomUUID());
  return dummyHash;
}

/** `locale` is the caller's to choose: the request's language for someone verifying their own account, English for an admin's resend. */
async function sendEmailOtp(userId: string, email: string, locale: Locale) {
  const code = generateOtpCode();
  await prisma.user.update({
    where: { id: userId },
    data: {
      emailOtpCodeHash: hashOtpCode(code),
      emailOtpExpires: new Date(Date.now() + EMAIL_OTP_TTL_MS),
      emailOtpAttempts: 0,
    },
  });

  const sent = await sendEmail({ to: email, ...verificationCodeEmail(locale, code) });
  if (!sent.ok) {
    // Nobody received this code, so don't leave it looking live: with no unexpired code on the account, /verify-email
    // (ensureFreshEmailOtp) sends a fresh one by itself on its next load instead of waiting for "Resend code".
    await prisma.user.update({
      where: { id: userId },
      data: { emailOtpCodeHash: null, emailOtpExpires: null },
    });
  }
  return sent;
}

/**
 * Called from the /verify-email page on every load — if the current code is
 * missing or has expired, silently sends a fresh one (rate-limit-gated, so
 * repeated page loads can't be abused to spam mail) instead of waiting for
 * the user to click "Resend code". This is the "automatic resend when stuck"
 * behavior for the email verification path.
 *
 * REAL BUG fixed here: this used to take userId/email/expires as plain
 * parameters instead of deriving them from the pending-verification cookie
 * the way every sibling function in this file does. The page only ever
 * called it with its own server-fetched user.email, but as an exported
 * Server Action it's independently callable by anyone with any arguments —
 * an attacker could have called this directly with a real pending user's
 * id alongside an email address they control, causing that user's real OTP
 * code to be generated and sent to the attacker's inbox instead (and
 * invalidating whatever code the real owner already had), a genuine
 * account-verification-hijack/DoS vector, plus an open relay for sending
 * arbitrary "your verification code is X" email to any address. Now derives
 * both the user id and email from the signed pending-verification cookie
 * and a direct DB lookup — nothing the caller supplies is trusted.
 */
export async function ensureFreshEmailOtp() {
  const pending = await readPendingVerification();
  if (!pending) return;
  const user = await prisma.user.findUnique({
    where: { id: pending.userId },
    select: { email: true, emailVerified: true, emailOtpExpires: true },
  });
  if (!user || user.emailVerified) return;
  if (user.emailOtpExpires && user.emailOtpExpires > new Date()) return;
  const allowed = await checkRateLimit("emailOtpSend", `otpsend:auto:${pending.userId}`);
  if (!allowed) return;
  await sendEmailOtp(pending.userId, user.email, await getLocale());
}

/**
 * The sign-up form's action (useActionState in src/components/sign-up-form.tsx). Anything that stops the account from
 * being created comes back as a SignUpState — every failing field with its own reason, or a form-level error — instead
 * of a redirect, so the form keeps what was typed (nothing the person entered ever goes into a URL). Success redirects.
 */
export async function signUpWithPassword(_prev: SignUpState, formData: FormData): Promise<SignUpState> {
  // Reuses the existing rate_limited copy rather than a distinct "bot
  // detected" message — no reason to tell a script which defense caught it.
  if (isBotSubmission(formData)) {
    return { fieldErrors: {}, formError: "rate_limited" };
  }

  const ip = await clientIp();
  // A real user can hit this (widget blocked or still loading), so unlike the
  // honeypot above it gets its own message telling them what to do.
  const botCheck = await passesBotGate(formData, ip, "signUpWithPassword");
  if (!botCheck.ok) {
    return { fieldErrors: {}, formError: captchaErrorCode(botCheck.reason) };
  }
  const allowed = await checkRateLimit("passwordSignUp", `signup:${ip}`);
  if (!allowed) {
    return { fieldErrors: {}, formError: "rate_limited" };
  }

  const checked = validateSignUp({
    username: formData.get("username"),
    email: formData.get("email"),
    password: formData.get("password"),
    birthDate: formData.get("birthDate"),
    verificationMethod: formData.get("verificationMethod"),
    phone: formData.get("phone") ?? undefined,
  });

  // Looked up for every field that passed validation, even when another one failed, so one round trip reports
  // everything that needs fixing.
  const { checkable } = checked;
  const [existingEmail, existingUsername, phoneOwner] = await Promise.all([
    checkable.email ? prisma.user.findUnique({ where: { email: checkable.email }, select: { id: true } }) : null,
    // Case-insensitive so "Bola" can't be registered next to "bola".
    checkable.username
      ? prisma.user.findFirst({
          where: { username: { equals: checkable.username, mode: "insensitive" } },
          select: { id: true },
        })
      : null,
    checkable.phone ? prisma.user.findUnique({ where: { phone: checkable.phone }, select: { id: true } }) : null,
  ]);
  const fieldErrors = withTakenErrors(checked.fieldErrors, {
    email: Boolean(existingEmail),
    username: Boolean(existingUsername),
    phone: Boolean(phoneOwner),
  });
  if (!checked.data || checked.formError || Object.keys(fieldErrors).length > 0) {
    return { fieldErrors, formError: checked.formError };
  }

  const { username, email, password, birthDate, verificationMethod, phone } = checked.data;

  const passwordHash = await hashPassword(password);
  let created;
  try {
    created = await prisma.user.create({
      data: {
        email,
        username,
        passwordHash,
        birthDate,
        status: "ACTIVE",
        pendingVerificationMethod: verificationMethod,
        // Birthday sharing starts on (the column default); an under-18 account is told once it turns 18.
        birthdaySharingNoticePending: birthdayNoticePendingAtSignUp(birthDate, BIRTHDAY_DEFAULT_AUDIENCE, new Date()),
      },
    });
  } catch (err) {
    // Two people racing for the same email/username: the loser gets the same message as the pre-check.
    if (isUniqueConstraintError(err)) return { fieldErrors: { username: "username_taken" }, formError: null };
    throw err;
  }
  await track("SIGN_UP", created.id, { method: "password" });

  if (verificationMethod === "PHONE") {
    // The number rides along in the pending-verification cookie; the verify-phone page texts the code to it as soon as
    // it opens (behind the same Turnstile check as every SMS send), so there is no second "enter your number" step.
    // It is only saved on the account once the code is confirmed.
    await issuePendingVerificationCookie(created.id, phone);
    redirect("/sign-up/verify-phone");
  }

  await sendEmailOtp(created.id, email, await getLocale());
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
  const user = await prisma.user.findUnique({ where: { id: userId }, omit: { emailOtpCodeHash: false } });
  if (!user || !user.emailOtpCodeHash || !user.emailOtpExpires) {
    redirect("/verify-email?error=expired");
  }
  if (user.emailOtpExpires < new Date()) {
    redirect("/verify-email?error=expired");
  }
  if (user.emailOtpAttempts >= EMAIL_OTP_MAX_ATTEMPTS) {
    redirect("/verify-email?error=too_many_attempts");
  }

  // The attempt is reserved BEFORE the code is compared, in one guarded write (same pattern as verifyDeviceChallenge):
  // read-compare-increment let parallel guesses (from many IPs, the limiter is per ip+user) all pass the cap check at
  // once. A correct code resets the count below.
  const reserved = await prisma.user.updateMany({
    where: { id: userId, emailOtpCodeHash: user.emailOtpCodeHash, emailOtpAttempts: { lt: EMAIL_OTP_MAX_ATTEMPTS } },
    data: { emailOtpAttempts: { increment: 1 } },
  });
  if (reserved.count === 0) {
    redirect("/verify-email?error=too_many_attempts");
  }

  if (hashOtpCode(code) !== user.emailOtpCodeHash) {
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
 * /verify-email's "Resend code" button. Needs the pending-verification cookie, which only exists in the browser that
 * just signed up or just proved the password of an unverified account (see loginWithPassword) — never from an email
 * address alone, which would let anyone trigger (or hijack) verification of someone else's account.
 */
export async function resendEmailOtp(formData: FormData) {
  const ip = await clientIp();
  const pending = await readPendingVerification();
  if (!pending) {
    redirect("/sign-in");
  }

  // Each resend is a real outbound email.
  const botCheck = await passesBotGate(formData, ip, "resendEmailOtp");
  if (!botCheck.ok) {
    redirect(`/verify-email?error=${captchaErrorCode(botCheck.reason)}`);
  }

  const { userId } = pending;
  const allowed = await checkRateLimit("emailOtpSend", `otpsend:${ip}:${userId}`);
  if (!allowed) {
    redirect("/verify-email?error=rate_limited");
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerified: true } });
  if (user && !user.emailVerified) {
    const sent = await sendEmailOtp(userId, user.email, await getLocale());
    // Don't say "a new code is on its way" when it isn't; the page offers resending and verifying by phone instead.
    if (!sent.ok) redirect("/verify-email?error=send_failed");
  }
  redirect("/verify-email?sent=1");
}

/**
 * "Email not arriving?" on /verify-email: verify by phone instead. The number is typed right there; the verify-phone
 * page texts the code to it as soon as it opens (behind the same Turnstile check as every SMS send). Requires the
 * pending-verification cookie, and the number is only saved on the account once its code is confirmed.
 */
export async function switchToPhoneVerification(formData: FormData) {
  const pending = await readPendingVerification();
  if (!pending) {
    redirect("/sign-in");
  }
  if (!(await checkRateLimit("verifyMethodSwitch", `switch:${pending.userId}`))) {
    redirect("/verify-email?error=rate_limited");
  }

  const parsed = validPhoneSchema.safeParse(formData.get("phone"));
  if (!parsed.success) {
    redirect("/verify-email?error=invalid_phone");
  }
  const owner = await prisma.user.findUnique({ where: { phone: parsed.data }, select: { id: true } });
  if (owner && owner.id !== pending.userId) {
    redirect("/verify-email?error=phone_taken");
  }

  await prisma.user.update({ where: { id: pending.userId }, data: { pendingVerificationMethod: "PHONE" } });
  await issuePendingVerificationCookie(pending.userId, parsed.data);
  redirect("/sign-up/verify-phone");
}

/**
 * "Not getting the text?" on /sign-up/verify-phone: verify by email code instead. /verify-email sends a fresh code by
 * itself when there isn't a live one (ensureFreshEmailOtp, rate-limited), so this just switches the method.
 */
export async function switchToEmailVerification() {
  const pending = await readPendingVerification();
  if (!pending) {
    redirect("/sign-in");
  }
  if (!(await checkRateLimit("verifyMethodSwitch", `switch:${pending.userId}`))) {
    redirect("/sign-up/verify-phone?error=rate_limited");
  }
  await prisma.user.update({ where: { id: pending.userId }, data: { pendingVerificationMethod: "EMAIL" } });
  await issuePendingVerificationCookie(pending.userId);
  redirect("/verify-email");
}

export async function loginWithPassword(formData: FormData) {
  const ip = await clientIp();
  const botCheck = await passesBotGate(formData, ip, "loginWithPassword");
  if (!botCheck.ok) {
    redirect(`/sign-in?error=${captchaErrorCode(botCheck.reason)}`);
  }
  // Skipped when the IP couldn't be determined: every such request would
  // otherwise share one "unknown" bucket and throttle everyone together.
  if (ip !== "unknown") {
    const ipAllowed = await checkRateLimit("passwordLoginIp", `loginip:${ip}`);
    if (!ipAllowed) {
      redirect("/sign-in?error=rate_limited");
    }
  }
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

  let user = await prisma.user.findFirst({
    where: {
      OR: [{ email: identifier.toLowerCase() }, { username: identifier }],
    },
    omit: { passwordHash: false, passwordResetRequiredAt: false },
  });
  if (!user) {
    // Usernames are unique case-insensitively for new sign-ups, so "Bola" and "bola" are the same person — but only
    // accept a case-different match when it is unambiguous (older accounts could differ only by case). Same for an
    // email address: sign-up stores it lowercased, but an account created through Google or Apple keeps the address
    // as the provider sent it. A username can't contain "@", so the identifier decides which column to try.
    const loose = await prisma.user.findMany({
      where: identifier.includes("@")
        ? { email: { equals: identifier, mode: "insensitive" } }
        : { username: { equals: identifier, mode: "insensitive" } },
      take: 2,
      omit: { passwordHash: false, passwordResetRequiredAt: false },
    });
    if (loose.length === 1) user = loose[0];
  }

  const account = user;
  const deviceId = await getDeviceId();

  // Brute-force lockout (src/lib/login-lockout.ts): per account x IP, per account x device, and account-wide at a
  // higher threshold, all in the database (the Upstash limiters above fail open). An identifier that matches no
  // account is counted and locked exactly the same way, and a locked attempt gets the same "too many attempts" answer
  // as the rate limiters, so nothing here says whether an account exists. Checked before the password, so a locked
  // attempt can't probe it. The account-wide lock never applies to a device the account already trusts, nor to the
  // App Review demo accounts (reviewers sign in from a new device each time and must not be lockable from elsewhere;
  // they still have the per-IP and per-device locks, and their password is a long, environment-only secret).
  const sourceKeys = lockoutSourceKeys(ip, deviceId);
  const subject: LoginSubject = account ? { userId: account.id } : { identifier };
  const locked = await isLoginLocked({
    subject,
    sourceKeys,
    accountLockedUntil: account?.lockedUntil ?? null,
    accountWideExempt: async () =>
      Boolean(account) &&
      (account!.isAppReviewDemo ||
        (deviceId !== null && (await evaluateDevice(account!.id, deviceId)).status === "known")),
  });
  if (locked) {
    redirect("/sign-in?error=rate_limited");
  }

  // The shared guest-preview identity (/try) has no password and is never signed in to; refused here as well.
  const canSignIn =
    account !== null &&
    Boolean(account.passwordHash) &&
    !account.isGuestPreview &&
    (account.status === "ACTIVE" || account.status === "DEACTIVATED");
  let passwordOk = false;
  if (canSignIn && account?.passwordHash) {
    passwordOk = await verifyPassword(password, account.passwordHash);
    // A demo account also needs the password that is configured right now (APP_REVIEW_DEMO_PASSWORD): with it unset
    // or rotated, no stored hash (e.g. one set from an old value) signs it in.
    if (account.isAppReviewDemo && !matchesAppReviewDemoPassword(password)) {
      if (!appReviewDemoPassword()) {
        console.error(
          `[app-review-demo] APP_REVIEW_DEMO_PASSWORD is not set or shorter than ${APP_REVIEW_DEMO_MIN_PASSWORD_LENGTH} characters: demo sign-in refused`,
        );
      }
      passwordOk = false;
    }
  } else {
    await verifyPassword(password, await dummyPasswordHash());
  }

  const outcome = passwordSignInOutcome({
    passwordOk,
    resetRequiredAt: account?.passwordResetRequiredAt ?? null,
    isAppReviewDemo: account?.isAppReviewDemo ?? false,
  });
  // Every failed credential case gets the same answer, including the failure that just locked.
  if (outcome === "wrong_password" || !account) {
    await recordLoginFailure({ subject, sourceKeys });
    redirect("/sign-in?error=invalid_credentials");
  }
  user = account;
  // Forced reset: the password is right but may no longer be used. Nothing is signed in and no account state changes
  // (the failed-attempt count and any lockout bookkeeping stay as they were); the owner gets the ordinary reset email,
  // under the same per-IP-and-address limit as "Forgot password", and resetPassword clears the flag.
  if (outcome === "reset_required") {
    if (await checkRateLimit("passwordResetRequest", `resetreq:${ip}:${user.email}`)) {
      await sendPasswordResetEmail(user.id, user.email, "required", await getLocale());
    }
    redirect("/sign-in?notice=reset_required");
  }
  if (signInNeedsVerification(user)) {
    // The password was just proven, so this browser may finish verifying the account: pick up where signup left off on
    // the page for the method they chose — both pages offer switching to the other (email delayed? use your phone).
    await issuePendingVerificationCookie(user.id);
    redirect(user.pendingVerificationMethod === "PHONE" ? "/sign-up/verify-phone" : "/verify-email");
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
  await clearLoginFailures(user.id, sourceKeys);

  // New/unrecognized-device step-up: the password alone proved the account,
  // but not that this browser/install is one the real owner already uses —
  // require an emailed code before actually establishing the session. The
  // account's very first-ever device is auto-trusted (evaluateDevice), so
  // this never blocks a brand-new signup's first sign-in.
  //
  // App Review reruns this exact sign-in from a different, unrecognized
  // device on every submission, from a mailbox reviewers can't read — an
  // emailed code would be an unclearable dead end (Apple Guideline 2.1).
  // isAppReviewDemo marks the one account behind App Store Connect's
  // demo credentials as exempt: every device it logs in from is trusted
  // outright, no challenge ever sent. (Kept on purpose: without it review
  // can't sign in at all. The account's password is an environment-only
  // secret of at least 16 characters, see src/lib/app-review-demo.ts.)
  if (user.isAppReviewDemo) {
    if (deviceId) await trustDevice(user.id, deviceId, await getDeviceLabel());
  } else {
    const evaluation = await evaluateDevice(user.id, deviceId);
    if (evaluation.status === "unrecognized" && deviceId) {
      const sendAllowed = await checkRateLimit("deviceChallengeSend", `devchallenge:send:${user.id}`);
      if (!sendAllowed) {
        redirect("/sign-in?error=rate_limited");
      }
      const label = await getDeviceLabel();
      const challenge = await createDeviceChallenge({
        userId: user.id,
        email: user.email,
        purpose: "LOGIN",
        deviceId,
        deviceLabel: label,
        locale: await getLocale(),
      });
      await issuePendingDeviceChallengeCookie(user.id, deviceId, challenge.id);
      redirect("/sign-in/verify-device");
    }
    if (deviceId) {
      if (evaluation.status === "trusted_first_device") {
        await trustDevice(user.id, deviceId, await getDeviceLabel());
      } else {
        await touchKnownDevice(user.id, deviceId);
      }
    }
  }

  await issueSessionCookie(user);
  await rememberLocale(user.id, user.locale);
  await track("SIGN_IN", user.id, { method: "password" });

  redirect("/home");
}

/**
 * Completes a new-device sign-in that loginWithPassword (or the NextAuth
 * signIn callback, for magic-link/OAuth — see src/lib/auth.ts) paused on.
 * Shared by both paths since neither has a real session yet at the point it
 * needs to pause, so both rely on the same signed pending-device-challenge
 * cookie (src/lib/device-challenge.ts) rather than anything session-based.
 */
export async function confirmLoginDeviceChallenge(formData: FormData) {
  const pending = await readPendingDeviceChallengeCookie();
  if (!pending) {
    redirect("/sign-in");
  }

  const ip = await clientIp();
  const botCheck = await passesBotGate(formData, ip, "confirmLoginDeviceChallenge");
  if (!botCheck.ok) {
    redirect(`/sign-in/verify-device?error=${captchaErrorCode(botCheck.reason)}`);
  }
  const allowed = await checkRateLimit("deviceChallengeCheck", `devchallenge:${ip}:${pending.sub}`);
  if (!allowed) {
    redirect("/sign-in/verify-device?error=rate_limited");
  }

  const code = String(formData.get("code") ?? "").trim();
  const result = await verifyDeviceChallenge(pending.challengeId, pending.sub, code);
  if (!result.ok) {
    redirect(`/sign-in/verify-device?error=${result.error}`);
  }

  const user = await prisma.user.findUnique({ where: { id: pending.sub } });
  if (!user || (user.status !== "ACTIVE" && user.status !== "DEACTIVATED")) {
    await clearPendingDeviceChallengeCookie();
    redirect("/sign-in?error=invalid_credentials");
  }

  await trustDevice(user.id, pending.deviceId, await getDeviceLabel());
  if (user.status === "DEACTIVATED") {
    await prisma.user.update({ where: { id: user.id }, data: { status: "ACTIVE", deactivatedAt: null } });
  }
  await issueSessionCookie(user);
  await rememberLocale(user.id, user.locale);
  await clearPendingDeviceChallengeCookie();
  await track("SIGN_IN", user.id, { method: "device_verified" });

  redirect("/home");
}

export async function resendLoginDeviceChallenge(formData: FormData) {
  const pending = await readPendingDeviceChallengeCookie();
  if (!pending) {
    redirect("/sign-in");
  }

  const botCheck = await passesBotGate(formData, await clientIp(), "resendLoginDeviceChallenge");
  if (!botCheck.ok) {
    redirect(`/sign-in/verify-device?error=${captchaErrorCode(botCheck.reason)}`);
  }

  const allowed = await checkRateLimit("deviceChallengeSend", `devchallenge:send:${pending.sub}`);
  if (!allowed) {
    redirect("/sign-in/verify-device?error=rate_limited");
  }

  const user = await prisma.user.findUnique({ where: { id: pending.sub }, select: { id: true, email: true } });
  if (!user) {
    redirect("/sign-in");
  }

  const label = await getDeviceLabel();
  const challenge = await createDeviceChallenge({
    userId: user.id,
    email: user.email,
    purpose: "LOGIN",
    deviceId: pending.deviceId,
    deviceLabel: label,
    locale: await getLocale(),
  });
  await issuePendingDeviceChallengeCookie(user.id, pending.deviceId, challenge.id);
  redirect("/sign-in/verify-device?sent=1");
}

/**
 * Always redirects to the same "check your email" page regardless of
 * whether the address is registered — otherwise this endpoint becomes an
 * account-enumeration oracle.
 */
export async function requestPasswordReset(formData: FormData) {
  // Same "always land on ?sent=1" anti-enumeration path as everything below
  // handles a detected bot too — no separate error state that would tell a
  // script its honeypot/timing got caught.
  if (isBotSubmission(formData)) {
    redirect("/forgot-password?sent=1");
  }

  const ip = await clientIp();
  const botCheck = await passesBotGate(formData, ip, "requestPasswordReset");
  if (!botCheck.ok) {
    redirect(`/forgot-password?error=${captchaErrorCode(botCheck.reason)}`);
  }
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    redirect("/forgot-password?error=invalid");
  }
  const { email } = parsed.data;

  const allowed = await checkRateLimit("passwordResetRequest", `resetreq:${ip}:${email}`);
  if (!allowed) {
    redirect("/forgot-password?sent=1");
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, status: true, isAppReviewDemo: true },
  });
  // The App Review demo accounts' password is set from APP_REVIEW_DEMO_PASSWORD only (fixAppReviewDemoAccount), never
  // by email: same landing page, nothing sent.
  if (user && user.status === "ACTIVE" && !user.isAppReviewDemo) {
    await sendPasswordResetEmail(user.id, email, "requested", await getLocale());
  }

  redirect("/forgot-password?sent=1");
}

export type ResetPasswordState = { error: "invalid" | "mismatch" | "same_password" | null };

/**
 * The reset form's action (useActionState in src/components/reset-password-form.tsx). The token only ever travels in
 * the POST body: a fixable error comes back as state, so the form keeps the token in memory instead of it being put
 * back into a URL. Success and an unusable token redirect.
 */
export async function resetPassword(_prev: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword") ?? "",
  });
  if (!parsed.success) {
    const mismatch = parsed.error.issues.some((i) => i.path[0] === "confirmPassword");
    return { error: mismatch ? "mismatch" : "invalid" };
  }
  const { token, password } = parsed.data;

  const resetToken = await prisma.passwordResetToken.findUnique({ where: { token: hashResetToken(token) } });
  if (!resetToken || resetToken.expires < new Date()) {
    redirect("/forgot-password?error=expired");
  }

  const target = await prisma.user.findUnique({
    where: { id: resetToken.userId },
    select: {
      failedLoginAttempts: true,
      lockedUntil: true,
      passwordHash: true,
      passwordResetRequiredAt: true,
      isAppReviewDemo: true,
    },
  });
  // A demo account's password comes from APP_REVIEW_DEMO_PASSWORD only (no link is ever sent for one, see
  // requestPasswordReset; this catches one issued before it was flagged).
  if (!target || target.isAppReviewDemo) {
    await prisma.passwordResetToken.deleteMany({ where: { userId: resetToken.userId } });
    redirect("/forgot-password?error=expired");
  }
  const hadLoginIssue = target.failedLoginAttempts > 0 || !!target.lockedUntil;

  // A forced reset exists to retire the old password, so it can't be chosen again.
  if (target.passwordResetRequiredAt && target.passwordHash && (await verifyPassword(password, target.passwordHash))) {
    return { error: "same_password" };
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
    // wait it out — this is the intended early-unlock path.
    data: {
      passwordHash,
      passwordResetRequiredAt: null,
      sessionInvalidatedAt: new Date(),
      failedLoginAttempts: 0,
      lockedUntil: null,
      failedLoginAt: null,
      ...(hadLoginIssue ? { loginIssueResolvedAt: new Date() } : {}),
    },
  });
  await prisma.passwordResetToken.deleteMany({ where: { userId: resetToken.userId } });
  // Proof of email ownership also clears every per-IP / per-device sign-in lock on the account.
  await clearAllLoginFailures(resetToken.userId);
  // A reset also ends the ambient widget's long-lived bearer token (it isn't a session, so sessionInvalidatedAt
  // doesn't reach it).
  await prisma.ambientWidgetToken.updateMany(activeWidgetTokensOf(resetToken.userId));

  redirect("/sign-in?reset=1");
}

/**
 * Admin-initiated password reset — for support cases where a customer can't
 * complete their own reset (e.g. they don't recognize the "email already in
 * use" they get on sign-up because they'd forgotten they already had an
 * account) or is locked out and doesn't want to wait. Uses the exact
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
  // Demo accounts get their password from APP_REVIEW_DEMO_PASSWORD via fixAppReviewDemoAccount, never a link.
  if (user.isAppReviewDemo) {
    return { error: "demo_account" as const };
  }

  const url = await issuePasswordResetLink(user.id);
  const sent = await sendEmail({
    to: user.email,
    subject: "Reset your YuKon3t password",
    html: `<p>A YuKon3t admin sent you this link after you contacted support about signing in.</p>
      <p><a href="${url}">Reset your password</a></p>
      <p>This link expires in 1 hour. If you didn't contact support about this, ignore this email — your password won't change.</p>`,
  });
  if (!sent.ok) {
    return { error: "email_failed" as const };
  }

  await prisma.auditLog.create({
    data: {
      targetId: user.id,
      action: "PASSWORD_RESET_SENT",
      reason: `Password reset link sent to ${user.email} by admin at their request.`,
      performedBy: admin.id,
    },
  });

  // No revalidatePath: neither /admin/moderation nor /admin/users shows
  // anything this changes (no token, OTP or audit-log column is rendered
  // there), and a revalidation would re-render the whole page inside this
  // request just to return the same rows.
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

  const sent = await sendEmailOtp(user.id, user.email, DEFAULT_LOCALE);
  if (!sent.ok) {
    return { error: "email_failed" as const };
  }

  await prisma.auditLog.create({
    data: {
      targetId: user.id,
      action: "VERIFICATION_EMAIL_SENT",
      reason: `Confirmation email re-sent to ${user.email} by admin — account was stuck unverified.`,
      performedBy: admin.id,
    },
  });

  // No revalidatePath: neither /admin/moderation nor /admin/users shows
  // anything this changes (no token, OTP or audit-log column is rendered
  // there), and a revalidation would re-render the whole page inside this
  // request just to return the same rows.
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
  // Same file cleanup as deleteMyAccount (account-media.ts): collected before the delete, removed after it.
  const media = await collectAccountMedia(user.id, user.avatarUrl);
  await prisma.user.delete({ where: { id: user.id } });
  await deleteAccountMedia(user.id, media);

  revalidatePath("/admin/users");
  return { error: null };
}

/**
 * Admin one-click fix for the App Store review demo accounts. A Server Action rather than only a local script because
 * a Server Action always runs against the database the deployed app uses (this repo's local .env points at a
 * different, non-production database: confirmed 2026-09-30, when the script reported "No user found" for an account
 * that existed in production).
 *
 * Sets the password of every demo account to APP_REVIEW_DEMO_PASSWORD, read on the server at the moment the button is
 * pressed. That variable is never in the repository and has no default: unset (or shorter than 16 characters) this
 * refuses and changes nothing. Finds (or creates) the primary account (APP_REVIEW_DEMO_USERNAME / _EMAIL, with
 * non-secret defaults, see src/lib/app-review-demo.ts) and also repairs every other account already flagged
 * isAppReviewDemo (e.g. a second account reviewers message). Nothing it returns or logs contains the password.
 */
export async function fixAppReviewDemoAccount() {
  const admin = await requireAdmin();

  const password = appReviewDemoPassword();
  if (!password) {
    return {
      error: "password_not_configured" as const,
      message: `APP_REVIEW_DEMO_PASSWORD is not set on this deployment, or is shorter than ${APP_REVIEW_DEMO_MIN_PASSWORD_LENGTH} characters. Set it on both Netlify and Vercel, redeploy, then press this again. Nothing was changed.`,
      before: null,
      action: null,
      othersRepaired: 0,
    };
  }
  const { username, email } = appReviewDemoIdentity();
  const passwordHash = await hashPassword(password);

  const repairData = {
    passwordHash,
    passwordResetRequiredAt: null,
    isAppReviewDemo: true,
    status: "ACTIVE" as const,
    deactivatedAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    failedLoginAt: null,
    // Every other session of the account ends, as on any password change.
    sessionInvalidatedAt: new Date(),
  };

  const existing = await prisma.user.findFirst({
    where: { OR: [{ username: { equals: username, mode: "insensitive" } }, { email }] },
    select: {
      id: true,
      username: true,
      email: true,
      status: true,
      emailVerified: true,
      lockedUntil: true,
      failedLoginAttempts: true,
      isAppReviewDemo: true,
    },
  });

  const before = existing
    ? {
        id: existing.id,
        username: existing.username,
        email: existing.email,
        status: existing.status,
        emailVerified: Boolean(existing.emailVerified),
        lockedUntil: existing.lockedUntil,
        failedLoginAttempts: existing.failedLoginAttempts,
        isAppReviewDemo: existing.isAppReviewDemo,
      }
    : null;

  let primaryId: string;
  if (!existing) {
    const created = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
        // Any adult date works — this account never goes through the real
        // signup age-gate, and nothing else reads birthDate for it.
        birthDate: new Date("1995-01-01"),
        status: "ACTIVE",
        emailVerified: new Date(),
        isAppReviewDemo: true,
      },
      select: { id: true },
    });
    primaryId = created.id;
  } else {
    primaryId = existing.id;
    await prisma.user.update({
      where: { id: existing.id },
      data: { ...repairData, username, email, emailVerified: existing.emailVerified ?? new Date() },
    });
  }

  // Every other flagged demo account gets the same password and the same repair.
  const others = await prisma.user.updateMany({
    where: { isAppReviewDemo: true, id: { not: primaryId } },
    data: repairData,
  });
  const demoIds = (
    await prisma.user.findMany({ where: { isAppReviewDemo: true }, select: { id: true } })
  ).map((u) => u.id);
  for (const id of demoIds) await clearAllLoginFailures(id);

  await prisma.auditLog.create({
    data: {
      targetId: primaryId,
      action: "APP_REVIEW_DEMO_ACCOUNT_FIXED",
      reason: existing
        ? `Repaired, password set from APP_REVIEW_DEMO_PASSWORD (${others.count} other demo account(s) too) — before: ${JSON.stringify(before)}`
        : `Created with the password from APP_REVIEW_DEMO_PASSWORD (${others.count} other demo account(s) repaired too) — did not exist in production.`,
      performedBy: admin.id,
    },
  });

  return {
    error: null,
    message: null,
    before,
    action: existing ? ("repaired" as const) : ("created" as const),
    othersRepaired: others.count,
  };
}
