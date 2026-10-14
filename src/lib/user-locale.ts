import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { captureError } from "@/lib/error-tracking";
import { LOCALE_COOKIE, type Locale } from "@/lib/i18n/locales";
import { localeToRecord } from "@/lib/user-locale-rules";

// Keeps User.locale (the language notifications are written in, see src/lib/push-text.ts) in step with the language
// the person uses the app in. Written from three places only, each at most once per change: the language picker
// (setLocale), signing in, and /api/badge-counts (fetched once when the nav mounts, then on realtime signals), which
// already has the user row in hand. Never on every request, and never from the presence heartbeat.

/**
 * Records this request's language for `userId` when localeToRecord says it changed. `stored` is the row's current
 * value, which every caller already has in hand, so deciding costs no read. Best-effort: a failure here must never fail
 * the request it rides on.
 */
export async function rememberLocale(userId: string, stored: string | null) {
  try {
    const next = localeToRecord(
      stored,
      (await cookies()).get(LOCALE_COOKIE)?.value,
      (await headers()).get("accept-language"),
    );
    if (next) await writeLocale(userId, next);
  } catch (err) {
    console.error("[user-locale] could not record the language", err);
    await captureError(err, { where: "rememberLocale" });
  }
}

/** Writes `locale` for `userId` unless it is already stored: the guard is in the WHERE, so an unchanged one writes nothing. */
export async function writeLocale(userId: string, locale: Locale) {
  await prisma.user.updateMany({
    where: { id: userId, OR: [{ locale: null }, { locale: { not: locale } }] },
    data: { locale },
  });
}
