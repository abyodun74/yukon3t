"use server";

import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { signUpSchema, loginSchema } from "@/lib/validations";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email";
import { sessionCookieName, SESSION_MAX_AGE_SECONDS } from "@/lib/auth-cookie";

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

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
  await prisma.user.create({
    data: { email, username, passwordHash, birthDate, status: "ACTIVE" },
  });

  await sendVerificationEmail(email);
  redirect("/sign-in/check-email?context=verify");
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
  if (user.status !== "ACTIVE") {
    redirect("/sign-in?error=invalid_credentials");
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    redirect("/sign-in?error=invalid_credentials");
  }
  if (!user.emailVerified) {
    redirect(`/sign-in?error=unverified&email=${encodeURIComponent(user.email)}`);
  }

  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await prisma.session.create({ data: { sessionToken, userId: user.id, expires } });

  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName(), sessionToken, {
    httpOnly: true,
    secure: process.env.AUTH_URL?.startsWith("https://") ?? true,
    sameSite: "lax",
    path: "/",
    expires,
  });

  redirect("/home");
}
