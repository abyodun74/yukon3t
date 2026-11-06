"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser, requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { birthdaySharingSchema, birthdayWishSchema } from "@/lib/validations";
import { canShareBirthday } from "@/lib/birthdays";
import { sendBirthdayWishAs, type BirthdayWishResult } from "@/lib/birthday-wish-server";
import { getDictionary } from "@/lib/i18n/server";

/**
 * Settings -> Privacy, "Share my birthday": off (the default), or who is reminded on the day (src/lib/birthdays.ts).
 * Turning it on needs a known birth date and an adult account (BIRTHDAY_MIN_AGE); turning it off always works.
 */
export async function updateBirthdaySharing(formData: FormData) {
  const user = await requireUser();
  const parsed = birthdaySharingSchema.safeParse({ audience: formData.get("audience") });
  if (!parsed.success) {
    redirect("/settings?error=other");
  }
  const audience = parsed.data.audience === "OFF" ? null : parsed.data.audience;
  if (audience && !canShareBirthday(user.birthDate, new Date())) {
    redirect("/settings?error=birthday_unavailable");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { birthdayAudience: audience },
    select: { id: true },
  });

  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

/**
 * The quick-wish sheet (birthday-wish-sheet.tsx): sends one birthday wish to `celebrantId` as a direct message. All the
 * rules (a reminder in the last 36 hours, still shared, audience, blocks, one per year, moderation, rate limits,
 * hidden and secret chats) are in sendBirthdayWishAs (src/lib/birthday-wish-server.ts).
 */
export async function sendBirthdayWish(input: unknown): Promise<BirthdayWishResult> {
  const user = await requireVerifiedUser();
  const parsed = birthdayWishSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const presets = (await getDictionary()).ui.birthdays.presets;
  const result = await sendBirthdayWishAs({ id: user.id, name: user.name }, parsed.data, presets);
  if (result.error === null) revalidatePath("/birthdays");
  return result;
}
