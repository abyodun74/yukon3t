"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { collabPostSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";

export async function createCollabPost(formData: FormData) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("postCreate", user.id);
  if (!allowed) {
    redirect("/collab/new?error=rate_limited");
  }

  const parsed = collabPostSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    type: formData.get("type"),
    countries: String(formData.get("countries") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  });
  if (!parsed.success) {
    redirect("/collab/new?error=invalid");
  }
  const { title, description, type, countries } = parsed.data;

  const modResult = await moderateText(`${title}\n${description}`);
  if (!modResult.allowed) {
    redirect("/collab/new?error=moderation");
  }

  await prisma.collabBoardPost.create({
    data: { title, description, type, countries, authorId: user.id },
  });

  revalidatePath("/collab");
  redirect("/collab");
}

export async function closeCollabPost(id: string) {
  const user = await requireVerifiedUser();
  await prisma.collabBoardPost.updateMany({
    where: { id, authorId: user.id },
    data: { status: "CLOSED" },
  });
  revalidatePath("/collab");
}
