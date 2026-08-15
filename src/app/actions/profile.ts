"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import {
  onboardingSchema,
  profileUpdateSchema,
  privacySchema,
  ringtoneSchema,
  setPasswordSchema,
  usernameSchema,
} from "@/lib/validations";
import { hashPassword } from "@/lib/passwords";
import { recomputeTrustScore } from "@/lib/trust";
import { moderateText } from "@/lib/moderation";
import { checkRateLimit } from "@/lib/rate-limit";
import { updateUserEmbedding } from "@/lib/embeddings";
import { revalidatePath } from "next/cache";
import { signOut } from "@/lib/auth";

export async function completeOnboarding(formData: FormData) {
  const user = await requireUser();

  const parsed = onboardingSchema.safeParse({
    name: formData.get("name"),
    bio: formData.get("bio") ?? "",
    country: formData.get("country"),
    languages: formData.getAll("languages"),
    interests: formData.getAll("interests"),
    openToIntents: formData.getAll("openToIntents"),
    birthDate: formData.get("birthDate"),
  });

  if (!parsed.success) {
    const underage = parsed.error.issues.some((i) => i.path[0] === "birthDate");
    redirect(`/onboarding?error=${underage ? "underage" : "invalid"}`);
  }

  const { name, bio, country, languages, interests, openToIntents, birthDate } = parsed.data;

  if (bio) {
    const modResult = await moderateText(bio);
    if (!modResult.allowed) {
      redirect("/onboarding?error=moderation");
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      name,
      bio,
      country,
      languages,
      interests,
      interestsLower: interests.map((i) => i.toLowerCase()),
      openToIntents,
      birthDate,
    },
  });
  await updateUserEmbedding(user.id, { name, username: user.username, bio, interests });

  await recomputeTrustScore(user.id);
  revalidatePath("/home");
  redirect("/home");
}

export async function updateProfile(formData: FormData) {
  const user = await requireUser();
  const parsed = profileUpdateSchema.safeParse({
    name: formData.get("name"),
    bio: formData.get("bio") ?? "",
    country: formData.get("country"),
    languages: formData.getAll("languages"),
    interests: formData.getAll("interests"),
    openToIntents: formData.getAll("openToIntents"),
  });

  if (!parsed.success) {
    redirect(`/u/${user.id}?error=invalid`);
  }

  const { name, bio, country, languages, interests, openToIntents } = parsed.data;

  if (bio) {
    const modResult = await moderateText(bio);
    if (!modResult.allowed) {
      redirect(`/u/${user.id}?error=moderation`);
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      name,
      bio,
      country,
      languages,
      interests,
      interestsLower: interests.map((i) => i.toLowerCase()),
      openToIntents,
    },
  });
  await updateUserEmbedding(user.id, { name, username: user.username, bio, interests });

  await recomputeTrustScore(user.id);
  revalidatePath(`/u/${user.id}`);
  redirect(`/u/${user.id}?saved=1`);
}

export async function updatePrivacy(formData: FormData) {
  const user = await requireUser();
  const parsed = privacySchema.safeParse({
    postsVisibility: formData.get("postsVisibility"),
    discoverable: formData.get("discoverable") === "on",
  });

  if (!parsed.success) {
    redirect("/settings?error=invalid");
  }

  // HIDDEN ("invisible to everyone") is admin-only — the Settings UI only
  // renders that option for admins, but a crafted form POST could still
  // submit it, so re-check here rather than trusting the client.
  if (parsed.data.postsVisibility === "HIDDEN" && !user.isAdmin) {
    redirect("/settings?error=invalid");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: parsed.data,
  });

  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function updateRingtone(formData: FormData) {
  const user = await requireUser();
  const parsed = ringtoneSchema.safeParse({ ringtone: formData.get("ringtone") });

  if (!parsed.success) {
    redirect("/settings?error=invalid");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: parsed.data,
  });

  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function setPassword(formData: FormData) {
  const user = await requireUser();
  const parsed = setPasswordSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) {
    redirect("/settings?error=invalid");
  }

  let username = user.username;
  if (!username) {
    const usernameResult = usernameSchema.safeParse(formData.get("username"));
    if (!usernameResult.success) {
      redirect("/settings?error=invalid");
    }
    const taken = await prisma.user.findUnique({ where: { username: usernameResult.data } });
    if (taken) {
      redirect("/settings?error=username_taken");
    }
    username = usernameResult.data;
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await prisma.user.update({ where: { id: user.id }, data: { username, passwordHash } });

  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function exportMyData() {
  const user = await requireUser();

  // Repeatable to trigger and expensive to serve (a full, unbounded dump of
  // everything the user has ever posted/sent) — not truncating the actual
  // export, since a partial "your data" download would be a correctness
  // problem in its own right, just capping how often it can be requested.
  const allowed = await checkRateLimit("dataExport", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const, data: null };
  }

  const data = await prisma.user.findUnique({
    where: { id: user.id },
    // Internal security fields — a bcrypt hash, lockout/session-revocation
    // state — have no place in a user-facing "download your data" file that
    // could end up pasted somewhere (a support ticket, a forum) with the
    // hash still intact.
    omit: {
      passwordHash: true,
      sessionInvalidatedAt: true,
      failedLoginAttempts: true,
      failedLoginAt: true,
      lockedUntil: true,
      loginIssueResolvedAt: true,
    },
    include: {
      posts: true,
      collabPosts: true,
      circleMemberships: { include: { circle: true } },
      sentConnections: true,
      receivedConnections: true,
      sentMessages: true,
      reportsFiled: true,
    },
  });
  return { error: null, data: JSON.stringify(data, null, 2) };
}

/**
 * A reversible, self-service pause: hides the profile and posts (both check
 * `status === "ACTIVE"`) without touching any data. Signing back in with a
 * verified email or working password flips status back to ACTIVE — see the
 * DEACTIVATED branches in password-auth.ts and lib/auth.ts's signIn callback.
 */
export async function deactivateAccount() {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: { status: "DEACTIVATED", deactivatedAt: new Date() },
  });
  await signOut({ redirectTo: "/" });
}

export async function deleteMyAccount() {
  const user = await requireUser();
  // Hard delete — never paywalled, never held hostage. Cascades handle
  // owned rows via the Prisma schema's onDelete: Cascade relations.
  await prisma.user.delete({ where: { id: user.id } });
  await signOut({ redirectTo: "/" });
}
