import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Resend from "next-auth/providers/resend";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/auth-cookie";
import { sessionTokenClaims } from "@/lib/session-token";
import { track } from "@/lib/analytics";
import { getDeviceId, getDeviceLabel } from "@/lib/device-id";
import { evaluateDevice, trustDevice, touchKnownDevice } from "@/lib/device-trust";
import { createDeviceChallenge, issuePendingDeviceChallengeCookie } from "@/lib/device-challenge";
import { checkRateLimit } from "@/lib/rate-limit";

const providers: Provider[] = [
  Resend({
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
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
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        session.user.isAdmin = Boolean(token.isAdmin);
        session.user.trustBand = token.trustBand as string | undefined;
      }
      session.issuedAt = token.issuedAt;
      return session;
    },
    async signIn({ user }) {
      if (!user?.email) return false;
      const existing = await prisma.user.findUnique({
        where: { email: user.email },
        select: { id: true, status: true },
      });
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
        // New/unrecognized-device step-up — same reasoning as password
        // login's own check in src/app/actions/password-auth.ts, and the
        // magic link/OAuth token was already single-use-consumed by this
        // point, so pausing here doesn't let it be replayed. Wrapped
        // fail-open: this is the app's primary sign-in path, and a bug or
        // outage in this brand-new subsystem must never be able to lock
        // every magic-link/OAuth user out of their account.
        try {
          const deviceId = await getDeviceId();
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
        } catch (err) {
          console.error("[auth] device step-up check failed, allowing sign-in", err);
        }

        await track("SIGN_IN", existing.id, { method: "magic_link_or_oauth" });
      }
      return true;
    },
  },
  events: {
    // Fires once, after the adapter has actually persisted the new user —
    // the reliable place to track a magic-link/OAuth sign-up, unlike the
    // signIn callback above.
    async createUser({ user }) {
      if (user.id) {
        await track("SIGN_UP", user.id, { method: "magic_link_or_oauth" });
      }
    },
  },
});
