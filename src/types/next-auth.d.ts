import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      isAdmin: boolean;
      trustBand?: string;
      /** A guest preview session (/try, src/lib/guest-preview.ts): read-only, short-lived, shared identity. */
      isGuest?: boolean;
    } & DefaultSession["user"];
    /**
     * Unix timestamp (seconds) the session was originally created at. Not
     * Auth.js's own `iat` claim — that gets reset to "now" every time the
     * JWT is re-signed to slide its expiry, so it can't mark session start.
     */
    issuedAt?: number;
    /** A guest preview session's own random id (every guest shares one user id): its per-visitor rate-limit key. */
    guestSessionId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    isAdmin?: boolean;
    trustBand?: string;
    issuedAt?: number;
    /** Set only by issueGuestSessionCookie (src/lib/guest-preview-server.ts). */
    guest?: boolean;
    guestSid?: string;
  }
}
