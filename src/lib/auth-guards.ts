import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isAccountVerified } from "@/lib/account-verification";
import { isGuestPreviewEnabled, isGuestSessionLive } from "@/lib/guest-preview";

export class AuthError extends Error {}

/**
 * Thrown by requireUser() (and so requireVerifiedUser/requireAdmin) for a guest preview session (src/lib/guest-preview.ts):
 * the guest may read, never write. Still an AuthError, so every existing `instanceof AuthError` path treats it as "not
 * allowed"; `code` lets a caller tell it apart.
 */
export class GuestReadOnlyError extends AuthError {
  readonly code = "guest_read_only" as const;
  constructor() {
    super("Create a free account to do this.");
  }
}

/**
 * The signed-in user behind this request, guest preview included. One query, which doubles as the revocation check:
 * sessions are stateless JWTs, so a ban/suspend or password reset can't delete them server-side, and any token issued
 * before sessionInvalidatedAt is treated as signed out. A guest session must carry the guest claim, still be inside
 * its lifetime and the feature must still be on; a guest claim on a non-guest row (or the reverse) is refused.
 */
async function resolveSessionUser() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new AuthError("Sign in required.");
  }
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user || user.status !== "ACTIVE") {
    throw new AuthError("Account is not active.");
  }
  if (
    user.sessionInvalidatedAt &&
    (!session.issuedAt || session.issuedAt * 1000 < user.sessionInvalidatedAt.getTime())
  ) {
    throw new AuthError("Session expired, please sign in again.");
  }
  const guestClaim = session.user.isGuest === true;
  if (guestClaim !== user.isGuestPreview) {
    throw new AuthError("Sign in required.");
  }
  if (
    user.isGuestPreview &&
    !isGuestSessionLive({ issuedAt: session.issuedAt, nowMs: Date.now(), enabled: isGuestPreviewEnabled() })
  ) {
    throw new AuthError("Guest preview ended.");
  }
  return user;
}

/**
 * Throws unless there's a signed-in, active member (never a guest preview session: GuestReadOnlyError). Returns the
 * user row minus the secret columns the Prisma client omits from every query (src/lib/prisma.ts). It is still a whole
 * row: never hand it to a browser. Every write path goes through this (or requireVerifiedUser/requireAdmin), which is
 * what makes guest preview read-only.
 */
export async function requireUser() {
  const user = await resolveSessionUser();
  if (user.isGuestPreview) {
    throw new GuestReadOnlyError();
  }
  return user;
}

/**
 * Like requireUser, but also lets a guest preview session through. READ-ONLY paths only: pages (page-guards.ts) and
 * the Server Actions allow-listed in src/lib/guest-preview-coverage.test.ts. Never write anything for the user this
 * returns without checking `isGuestPreview` first.
 */
export async function requireViewer() {
  return resolveSessionUser();
}

/**
 * The identifier a per-user rate limit should count a viewer under. A member: their id. A guest preview session:
 * its own random session id, because every guest shares one user id and would otherwise share one budget.
 */
export async function viewerRateLimitKey(user: { id: string; isGuestPreview: boolean }) {
  if (!user.isGuestPreview) return user.id;
  const session = await auth();
  return `guest:${session?.guestSessionId ?? "unknown"}`;
}

/** requireViewer plus requireVerifiedUser's verified-account rule (the guest row counts as verified). Read-only paths only. */
export async function requireVerifiedViewer() {
  const user = await requireViewer();
  if (!isAccountVerified(user)) {
    throw new AuthError("Verify your account to use this feature.");
  }
  return user;
}

/**
 * Like requireUser, but also requires a verified account: email or phone, whichever sign-up used (isAccountVerified,
 * the same rule password sign-in lets an account in on). Gates posting, messaging, calls and the rest.
 */
export async function requireVerifiedUser() {
  const user = await requireUser();
  if (!isAccountVerified(user)) {
    throw new AuthError("Verify your account to use this feature.");
  }
  return user;
}

/**
 * The account's password hash, or null when it has no password (magic-link / OAuth only). It is omitted from every
 * other User query, so this is how a re-authentication check reads it. Server-side only; never return it.
 */
export async function getPasswordHash(userId: string) {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  return row?.passwordHash ?? null;
}

/**
 * Whether the account's password is one that must be replaced (User.passwordResetRequiredAt, see SECURITY.md). Like
 * the hash, that column is omitted from every other User query. For the signed-in user's own account only.
 */
export async function isPasswordResetRequired(userId: string) {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { passwordResetRequiredAt: true } });
  return Boolean(row?.passwordResetRequiredAt);
}

export async function requireAdmin() {
  const user = await requireUser();
  if (!user.isAdmin) {
    throw new AuthError("Admin access required.");
  }
  return user;
}
