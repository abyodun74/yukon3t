import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

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

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
