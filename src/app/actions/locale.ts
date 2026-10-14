"use server";

import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_SECONDS } from "@/lib/i18n/locales";
import { writeLocale } from "@/lib/user-locale";
import { captureError } from "@/lib/error-tracking";

/**
 * The language picker's action (src/components/language-picker.tsx). Open to signed-out visitors by design: it only
 * records which of the supported languages this browser wants the account screens in. Setting a cookie in a Server
 * Action makes Next re-render the current page, so the screen comes back in the new language on the same route.
 * Not httpOnly: nothing sensitive, and the value is never trusted beyond isLocale(). Signed in, it is also recorded on
 * the account (User.locale), so notifications follow it (src/lib/user-locale.ts).
 */
export async function setLocale(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
  });
  try {
    const userId = (await auth())?.user?.id;
    if (userId) await writeLocale(userId, locale);
  } catch (err) {
    // The cookie is set either way; the account catches up on the next sign-in or badge fetch.
    await captureError(err, { where: "setLocale" });
  }
}
