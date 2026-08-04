import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      isAdmin: boolean;
      trustBand?: string;
    } & DefaultSession["user"];
    /**
     * Unix timestamp (seconds) the session was originally created at. Not
     * Auth.js's own `iat` claim — that gets reset to "now" every time the
     * JWT is re-signed to slide its expiry, so it can't mark session start.
     */
    issuedAt?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    isAdmin?: boolean;
    trustBand?: string;
    issuedAt?: number;
  }
}
