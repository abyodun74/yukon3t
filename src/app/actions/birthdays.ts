"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser, requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { birthDateOnceSchema, birthdaySharingSchema, birthdayWishSchema } from "@/lib/validations";
import { birthdayNoticePendingAtSignUp, canShareBirthday, isSharingBirthday } from "@/lib/birthdays";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendBirthdayWishAs, type BirthdayWishResult } from "@/lib/birthday-wish-server";
import { getDictionary } from "@/lib/i18n/server";

/**
 * Settings -> Privacy, "Share my birthday": who is reminded on the day (src/lib/birthdays.ts). On by default (BOTH);
 * NONE is Off ("Turn off"), and is always accepted. Changing to another way of sharing, including turning it back on
 * after Off, needs a known birth date and an adult account (BIRTHDAY_MIN_AGE): an under-18 account that turned it off
 * can't turn it on again until 18, and the page says so (birthdaySettingsView) instead of offering it. Any choice made
 * here also clears a still-pending default-on notice (BIRTHDAY_SHARING_ON), so turning it back on never sends one: the
 * person has seen the setting and decided.
 */
export async function updateBirthdaySharing(formData: FormData) {
  const user = await requireUser();
  const parsed = birthdaySharingSchema.safeParse({ audience: formData.get("audience") });
  if (!parsed.success) {
    redirect("/settings?error=other");
  }
  const audience = parsed.data.audience;
  // Keeping the choice already stored is always fine (an under-18 account starts on BOTH like everyone, and it only
  // takes effect at BIRTHDAY_MIN_AGE); picking a new way to share needs it to be shareable now.
  if (
    isSharingBirthday(audience) &&
    audience !== user.birthdayAudience &&
    !canShareBirthday(user.birthDate, new Date())
  ) {
    redirect("/settings?error=birthday_unavailable");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { birthdayAudience: audience, birthdaySharingNoticePending: false },
    select: { id: true },
  });

  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

/**
 * Settings -> Privacy -> Birthday, "Add your birth date": for an account with no birth date on it (some older accounts;
 * every other path records one at sign-up or onboarding). One time only: the write is a single `updateMany` guarded on
 * `birthDate: null`, so a repeat, a double submit or a race with onboarding can never replace a birth date already
 * there, and nothing else in the app edits it. Same age rules as sign-up (birthDateOnceSchema: at least MIN_AGE, no
 * older than the picker offers), and the "can't be changed later" box must be ticked.
 *
 * The sharing choice (birthdayAudience) is left as it is. Under BIRTHDAY_MIN_AGE the account is owed the one-time
 * "your birthday is now shared" notice for when it turns 18, exactly as at sign-up (birthdayNoticePendingAtSignUp); an
 * adult isn't, since they are looking at the setting right now (the helper answers false for them, and this also
 * clears any notice still pending from before).
 */
export async function setBirthDateOnce(formData: FormData) {
  const user = await requireUser();
  if (!(await checkRateLimit("birthDateSet", user.id))) {
    redirect("/settings?error=rate_limited");
  }
  if (user.birthDate !== null) {
    redirect("/settings?error=birth_date_already_set");
  }
  const parsed = birthDateOnceSchema.safeParse({
    birthDate: formData.get("birthDate"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const code =
      issue?.path[0] === "confirm"
        ? "birth_date_confirm"
        : issue?.message === "underage"
          ? "birth_date_underage"
          : "birth_date_invalid";
    redirect(`/settings?error=${code}`);
  }
  const { birthDate } = parsed.data;

  const { count } = await prisma.user.updateMany({
    where: { id: user.id, birthDate: null },
    data: {
      birthDate,
      birthdaySharingNoticePending: birthdayNoticePendingAtSignUp(birthDate, user.birthdayAudience, new Date()),
    },
  });
  if (count === 0) {
    redirect("/settings?error=birth_date_already_set");
  }

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
