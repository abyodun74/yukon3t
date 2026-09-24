// One-off: finds and terminates whatever Postgres backend is holding a
// stuck advisory lock — a session-scoped lock that never got released,
// typically because its connection dropped abruptly instead of cleanly
// disconnecting. Confirmed live 2026-09-24, right after a Neon password
// rotation: every `prisma migrate deploy` (both Vercel and Netlify's
// production builds run this) started failing with
//   "Timed out trying to acquire a postgres advisory lock"
// A plain Neon compute restart did NOT clear it (tried twice) — this goes
// straight at the actual stuck session instead. See prisma.config.ts's own
// comment for why this lock exists (migrate deploy's own concurrency guard).
//
// Run against PRODUCTION (point DATABASE_URL at Neon, not local dev):
//   npx tsx scripts/clear-stuck-advisory-lock.ts
//
// Safe: only ever inspects/terminates a session that pg_locks itself says
// is holding or waiting on an advisory lock — never an ordinary query —
// and prints what it found before acting. No-ops cleanly if nothing's
// actually stuck.

import "dotenv/config";
import { prisma } from "@/lib/prisma";

type LockHolder = {
  pid: number;
  granted: boolean;
  state: string | null;
  query: string | null;
  query_start: Date | null;
  application_name: string | null;
};

async function main() {
  const rows = await prisma.$queryRawUnsafe<LockHolder[]>(`
    SELECT l.pid, l.granted, a.state, a.query, a.query_start, a.application_name
    FROM pg_locks l
    JOIN pg_stat_activity a ON a.pid = l.pid
    WHERE l.locktype = 'advisory'
  `);

  if (rows.length === 0) {
    console.log("No advisory locks currently held — nothing to clear. The build failure has another cause.");
    return;
  }

  console.log(`Found ${rows.length} advisory-lock-related session(s):`, rows);

  for (const row of rows) {
    if (!row.granted) {
      // A row that's *waiting* (not holding) the lock — e.g. our own
      // previous failed migrate attempts, already long gone. Nothing to do.
      continue;
    }
    await prisma.$queryRawUnsafe(`SELECT pg_terminate_backend($1)`, row.pid);
    console.log(`Terminated pid ${row.pid} (was holding the lock).`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
