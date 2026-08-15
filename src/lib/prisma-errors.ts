import { Prisma } from "@/generated/prisma/client";

/** True for a unique-constraint violation (P2002) — the expected outcome of a check-then-create race under a fast double-click/double-submit, not a real failure. */
export function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
