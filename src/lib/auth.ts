import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Resend from "next-auth/providers/resend";
import Google from "next-auth/providers/google";
import Apple from "next-auth/providers/apple";
import { isAppleSignInConfigured, getAppleClientSecret } from "@/lib/apple-client-secret";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/auth-cookie";
import { sessionTokenClaims } from "@/lib/session-token";
import { track } from "@/lib/analytics";
import { getDeviceId, getDeviceLabel } from "@/lib/device-id";
import { evaluateDevice, trustDevice, touchKnownDevice } from "@/lib/device-trust";
import { createDeviceChallenge, issuePendingDeviceChallengeCookie } from "@/lib/device-challenge";
import { checkRateLimit } from "@/lib/rate-limit";
import { magicLinkEmail } from "@/lib/account-emails";
import { localeFromRequest } from "@/lib/i18n/locales";
import { getLocale } from "@/lib/i18n/server";
import { rememberLocale } from "@/lib/user-locale";
import { providerVerifiedEmail } from "@/lib/oauth-email-verification";
import { captureError } from "@/lib/error-tracking";
import { recomputeTrustScore } from "@/lib/trust";
import { isGuestPreviewEnabled, isGuestSessionLive } from "@/lib/guest-preview";

const providers: Provider[] = [
  Resend({
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
    // Auth.js's own sendVerificationRequest with one difference: the email is written in the language of the request
    // that asked for the link (the picker's cookie, else Accept-Language) instead of always English.
    async sendVerificationRequest({ identifier: to, provider, url, theme, request }) {
      const { host } = new URL(url);
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: provider.from, to, ...magicLinkEmail(localeFromRequest(request), { url, host, theme }) }),
      });
      if (!res.ok) throw new Error("Resend error: " + JSON.stringify(await res.json()));
    },
  }),
];

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  );
}

if (isAppleSignInConfigured()) {
  providers.push(
    Apple({
      clientId: process.env.AUTH_APPLE_ID!,
      // A fresh JWT signed on demand (see apple-client-secret.ts), not a
      // static env var — same reasoning as that file's own doc comment.
      clientSecret: getAppleClientSecret(),
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // JWT sessions validate on every request without a database round trip —
  // at high concurrency, database-strategy sessions (a Session-table lookup
  // per request) become the dominant bottleneck. Continuous enforcement of
  // bans/suspensions and forced re-auth (e.g. password reset) still happens
  // via requireUser()'s single query against sessionInvalidatedAt/status —
  // see src/lib/auth-guards.ts.
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  providers,
  pages: {
    signIn: "/sign-in",
    verifyRequest: "/sign-in/check-email",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        Object.assign(
          token,
          sessionTokenClaims(user as { isAdmin?: boolean; trustBand?: string }),
        );
        // A real sign-in never carries the guest claims, even if a guest cookie was present before it.
        delete token.guest;
        delete token.guestSid;
      }
      // A guest preview session (src/lib/guest-preview.ts) ends for good once its fixed lifetime is over or the
      // feature is switched off: returning null makes auth() answer "signed out" everywhere (pages, actions, the
      // avatar route) and clears the cookie wherever Auth.js can write it. No database read.
      if (
        token.guest === true &&
        !isGuestSessionLive({ issuedAt: token.issuedAt, nowMs: Date.now(), enabled: isGuestPreviewEnabled() })
      ) {
        return null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        session.user.isAdmin = Boolean(token.isAdmin);
        session.user.trustBand = token.trustBand as string | undefined;
        session.user.isGuest = token.guest === true;
      }
      session.issuedAt = token.issuedAt;
      if (token.guest === true) session.guestSessionId = token.guestSid;
      return session;
    },
    async signIn({ user }) {
      if (!user?.email) return false;
      const existing = await prisma.user.findUnique({
        where: { email: user.email },
        select: { id: true, status: true, isAppReviewDemo: true, isGuestPreview: true, locale: true },
      });
      // The shared guest-preview identity is only ever entered through /try (issueGuestSessionCookie), never signed in to.
      if (existing?.isGuestPreview) return false;
      if (
        existing?.status === "SUSPENDED" ||
        existing?.status === "BANNED" ||
        existing?.status === "DELETED"
      ) {
        return false;
      }
      // Signing in again is treated as an explicit request to come back —
      // same pattern as most social apps' "log in to reactivate" flow.
      if (existing?.status === "DEACTIVATED") {
        await prisma.user.update({
          where: { id: existing.id },
          data: { status: "ACTIVE", deactivatedAt: null },
        });
      }
      // Only tracked for an existing (already-persisted) user — for a
      // brand-new sign-up, this callback fires before the adapter has
      // actually created the User row, so `user.id` here doesn't yet exist
      // in Postgres and logging against it throws a foreign-key violation.
      // See events.createUser below for the correct place to track that.
      if (existing) {
        // The language notifications are written in (src/lib/user-locale.ts); best-effort, never blocks sign-in.
        await rememberLocale(existing.id, existing.locale);
        // New/unrecognized-device step-up — same reasoning as password
        // login's own check in src/app/actions/password-auth.ts, and the
        // magic link/OAuth token was already single-use-consumed by this
        // point, so pausing here doesn't let it be replayed. Wrapped
        // fail-open: this is the app's primary sign-in path, and a bug or
        // outage in this brand-new subsystem must never be able to lock
        // every magic-link/OAuth user out of their account.
        try {
          const deviceId = await getDeviceId();
          // See isAppReviewDemo in password-auth.ts's loginWithPassword —
          // same exemption, kept here too in case a future demo account
          // ever signs in via magic link/OAuth instead of a password.
          if (existing.isAppReviewDemo) {
            if (deviceId) await trustDevice(existing.id, deviceId, await getDeviceLabel());
          } else {
            const evaluation = await evaluateDevice(existing.id, deviceId);
            if (evaluation.status === "unrecognized" && deviceId) {
              const sendAllowed = await checkRateLimit("deviceChallengeSend", `devchallenge:send:${existing.id}`);
              if (sendAllowed) {
                const label = await getDeviceLabel();
                const challenge = await createDeviceChallenge({
                  userId: existing.id,
                  email: user.email,
                  purpose: "LOGIN",
                  deviceId,
                  deviceLabel: label,
                  locale: await getLocale(),
                });
                await issuePendingDeviceChallengeCookie(existing.id, deviceId, challenge.id);
                // Returning a URL instead of true aborts this sign-in attempt
                // (no session cookie gets issued) and redirects there instead
                // — /sign-in/verify-device finishes the sign-in itself once
                // the emailed code is confirmed (confirmLoginDeviceChallenge).
                return "/sign-in/verify-device";
              }
            } else if (deviceId) {
              if (evaluation.status === "trusted_first_device") {
                await trustDevice(existing.id, deviceId, await getDeviceLabel());
              } else {
                await touchKnownDevice(existing.id, deviceId);
              }
            }
          }
        } catch (err) {
          console.error("[auth] device step-up check failed, allowing sign-in", err);
        }

        await track("SIGN_IN", existing.id, { method: "magic_link_or_oauth" });
      }
      return true;
    },
  },
  events: {
    // Fires only after Auth.js has finished a sign-in: the account exists and, for Google/Apple, the provider account is
    // linked to it (a refused link, a suspended account or a pending device challenge never gets here). Auth.js stores
    // every OAuth account with emailVerified: null, so this is where the provider's own "this email is verified" claim
    // (providerVerifiedEmail) is recorded. Only for the address on the account itself, matched case-insensitively: a
    // provider vouching for a different address proves nothing about this account's. Only fills an empty column, never
    // overwrites a date. Best-effort: a failure here must not turn a finished sign-in into an error.
    async signIn({ user, account, profile }) {
      const verifiedEmail = providerVerifiedEmail(account?.provider, profile);
      if (!verifiedEmail || !user?.id) return;
      try {
        const marked = await prisma.user.updateMany({
          where: { id: user.id, emailVerified: null, email: { equals: verifiedEmail, mode: "insensitive" } },
          data: { emailVerified: new Date() },
        });
        // A verified email is part of the trust score, same as when the email code is confirmed.
        if (marked.count > 0) await recomputeTrustScore(user.id);
      } catch (err) {
        console.error("[auth] could not record the provider's email verification", err);
        await captureError(err, { where: "events.signIn", provider: account?.provider });
      }
    },
    // Fires once, after the adapter has actually persisted the new user —
    // the reliable place to track a magic-link/OAuth sign-up, unlike the
    // signIn callback above.
    async createUser({ user }) {
      if (user.id) {
        await track("SIGN_UP", user.id, { method: "magic_link_or_oauth" });
        await rememberLocale(user.id, null);
      }
    },
  },
});
