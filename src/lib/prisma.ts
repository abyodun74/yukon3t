import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Each serverless function instance gets its own connection pool. With many
// instances running concurrently, a large per-instance `max` multiplies into
// far more Postgres connections than the database can hold — this is what
// actually caps concurrent capacity in a serverless deployment, well before
// any application-level limit. Keep each pool small and put a real pooler
// (Neon's built-in PgBouncer endpoint, i.e. a "-pooler" connection string,
// or standalone PgBouncer/Supavisor) in front of Postgres to absorb the
// aggregate connection count across all instances.
const adapter = new PrismaPg(
  {
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  },
  {
    // An idle client erroring (e.g. the DB dropping a stale connection)
    // emits 'error' on the pool; unhandled, that crashes the whole process.
    onPoolError: (err) => console.error("Postgres pool error:", err),
  },
);

const createPrismaClient = () =>
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    // The hidden-chats PIN hash and its lockout state are left out of EVERY User query unless one asks for them by
    // name (getHiddenPinState in src/lib/hidden-chats.ts is the only reader). Whole User rows are handed around
    // freely in this app (requireUser, pages, some Server Action results), and none of them may carry these.
    //
    // passwordHash and emailOtpCodeHash are left out the same way: no UI needs either, so the few server-side checks
    // that do (getPasswordHash in src/lib/auth-guards.ts, loginWithPassword, confirmEmailOtp) ask for them by name.
    // passwordResetRequiredAt is not a secret, but nobody else may learn whose password is still the pre-reset one.
    omit: {
      user: {
        hiddenChatsPinHash: true,
        hiddenPinFailedAttempts: true,
        hiddenPinLockedUntil: true,
        passwordHash: true,
        emailOtpCodeHash: true,
        passwordResetRequiredAt: true,
      },
    },
  });

// Typed from the factory, not as a bare PrismaClient, so the omit above is part of every query's result type too:
// reading an omitted column without selecting it is a compile error, not an undefined at runtime.
const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

/** What `prisma.$transaction(async (tx) => ...)` hands its callback; `prisma` itself also fits. */
export type TransactionClient = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
