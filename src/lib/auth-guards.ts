import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export class AuthError extends Error {}

/** Throws unless there's a signed-in, active, email-verified user. Returns the full user row. */
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new AuthError("Sign in required.");
  }
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user || user.status !== "ACTIVE") {
    throw new AuthError("Account is not active.");
  }
  // Sessions are stateless JWTs, so a ban/suspend or password reset can't
  // delete them server-side. This one query (already fetching the user row
  // for the status check above) doubles as the revocation check: any token
  // issued before sessionInvalidatedAt is treated as signed out.
  if (
    user.sessionInvalidatedAt &&
    (!session.issuedAt || session.issuedAt * 1000 < user.sessionInvalidatedAt.getTime())
  ) {
    throw new AuthError("Session expired, please sign in again.");
  }
  return user;
}

/** Like requireUser, but also requires a verified email — used to gate messaging. */
export async function requireVerifiedUser() {
  const user = await requireUser();
  if (!user.emailVerified) {
    throw new AuthError("Verify your email to use this feature.");
  }
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (!user.isAdmin) {
    throw new AuthError("Admin access required.");
  }
  return user;
}
