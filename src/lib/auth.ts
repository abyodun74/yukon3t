import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Resend from "next-auth/providers/resend";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/auth-cookie";
import { sessionTokenClaims } from "@/lib/session-token";
import { track } from "@/lib/analytics";

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
      if (existing) {
        await track("SIGN_IN", existing.id, { method: "magic_link_or_oauth" });
      } else if (user.id) {
        await track("SIGN_UP", user.id, { method: "magic_link_or_oauth" });
      }
      return true;
    },
  },
});
