"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { onboardingSchema } from "@/lib/validations";
import { recomputeTrustScore } from "@/lib/trust";
import { moderateText } from "@/lib/moderation";
import { revalidatePath } from "next/cache";
import { signOut } from "@/lib/auth";

function parseListField(formData: FormData, key: string) {
  return String(formData.get(key) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function completeOnboarding(formData: FormData) {
  const user = await requireUser();

  const parsed = onboardingSchema.safeParse({
    name: formData.get("name"),
    bio: formData.get("bio") ?? "",
    country: formData.get("country"),
    languages: parseListField(formData, "languages"),
    interests: parseListField(formData, "interests"),
    openToIntents: formData.getAll("openToIntents"),
  });

  if (!parsed.success) {
    redirect("/onboarding?error=invalid");
  }

  const { name, bio, country, languages, interests, openToIntents } = parsed.data;

  if (bio) {
    const modResult = await moderateText(bio);
    if (!modResult.allowed) {
      redirect("/onboarding?error=moderation");
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { name, bio, country, languages, interests, openToIntents },
  });

  await recomputeTrustScore(user.id);
  revalidatePath("/discover");
  redirect("/discover");
}

export async function updateProfile(formData: FormData) {
  const user = await requireUser();
  const parsed = onboardingSchema.safeParse({
    name: formData.get("name"),
    bio: formData.get("bio") ?? "",
    country: formData.get("country"),
    languages: parseListField(formData, "languages"),
    interests: parseListField(formData, "interests"),
    openToIntents: formData.getAll("openToIntents"),
  });

  if (!parsed.success) {
    redirect("/settings?error=invalid");
  }

  const { name, bio, country, languages, interests, openToIntents } = parsed.data;

  if (bio) {
    const modResult = await moderateText(bio);
    if (!modResult.allowed) {
      redirect("/settings?error=moderation");
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { name, bio, country, languages, interests, openToIntents },
  });

  await recomputeTrustScore(user.id);
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function exportMyData() {
  const user = await requireUser();
  const data = await prisma.user.findUnique({
    where: { id: user.id },
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
  return JSON.stringify(data, null, 2);
}

export async function deleteMyAccount() {
  const user = await requireUser();
  // Hard delete — never paywalled, never held hostage. Cascades handle
  // owned rows via the Prisma schema's onDelete: Cascade relations.
  await prisma.user.delete({ where: { id: user.id } });
  await signOut({ redirectTo: "/" });
}
