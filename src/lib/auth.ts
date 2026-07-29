import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Resend from "next-auth/providers/resend";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

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
  session: { strategy: "database" },
  providers,
  pages: {
    signIn: "/sign-in",
    verifyRequest: "/sign-in/check-email",
  },
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        session.user.isAdmin = Boolean(
          (user as { isAdmin?: boolean }).isAdmin,
        );
        session.user.trustBand = (
          user as { trustBand?: string }
        ).trustBand;
      }
      return session;
    },
    async signIn({ user }) {
      if (!user?.email) return false;
      const existing = await prisma.user.findUnique({
        where: { email: user.email },
        select: { status: true },
      });
      if (
        existing?.status === "SUSPENDED" ||
        existing?.status === "BANNED" ||
        existing?.status === "DELETED"
      ) {
        return false;
      }
      return true;
    },
  },
});
