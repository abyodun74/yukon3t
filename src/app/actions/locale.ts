"use server";

import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_SECONDS } from "@/lib/i18n/locales";

/**
 * The language picker's action (src/components/language-picker.tsx). Open to signed-out visitors by design: it only
 * records which of the supported languages this browser wants the account screens in. Setting a cookie in a Server
 * Action makes Next re-render the current page, so the screen comes back in the new language on the same route.
 * Not httpOnly: nothing sensitive, and the value is never trusted beyond isLocale().
 */
export async function setLocale(locale: string) {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
  });
}
