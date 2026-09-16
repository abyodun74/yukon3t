// Restores a database backup produced by src/lib/db-backup.ts
// (backup-database cron). This is a manual, deliberate disaster-recovery
// tool — it is never run automatically, and it is destructive: --apply
// TRUNCATEs every table this backup contains and re-inserts its rows,
// against whatever DATABASE_URL currently points at. Double-check that
// env var before running this against anything you care about.
//
// Usage:
//   npx tsx scripts/restore-database-backup.ts
//     Lists available backups (newest first) and exits — nothing is touched.
//
//   npx tsx scripts/restore-database-backup.ts --key <backup key>
//     Dry run: downloads and decrypts the given backup, reports table/row
//     counts. Still does not touch the database.
//
//   npx tsx scripts/restore-database-backup.ts --key <backup key> --apply --yes
//     Actually restores. Both --apply and --yes are required together —
//     either alone is treated as a dry run, so a typo can't accidentally
//     trigger a real restore.
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { listBackups, fetchBackup } from "@/lib/db-backup";

function parseArgs(argv: string[]) {
  const args: { key?: string; apply: boolean; yes: boolean } = { apply: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--key") args.key = argv[++i];
    else if (argv[i] === "--apply") args.apply = true;
    else if (argv[i] === "--yes") args.yes = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.key) {
    const backups = await listBackups();
    if (backups.length === 0) {
      console.log("No backups found in BACKUP_R2_BUCKET_NAME.");
      return;
    }
    console.log("Available backups (newest first):\n");
    for (const b of backups) {
      console.log(`  ${b.key}  (${b.lastModified.toISOString()}, ${(b.size / 1024 / 1024).toFixed(2)} MB)`);
    }
    console.log("\nRe-run with --key <one of the above> to inspect or restore it.");
    return;
  }

  console.log(`Downloading and decrypting ${args.key}...`);
  const backup = await fetchBackup(args.key);
  const tableNames = Object.keys(backup.tables);
  const totalRows = tableNames.reduce((sum, t) => sum + backup.tables[t].length, 0);

  console.log(`\nBackup created at: ${backup.createdAt}`);
  console.log(`Tables: ${tableNames.length}, total rows: ${totalRows}\n`);
  for (const t of tableNames) {
    console.log(`  ${t}: ${backup.tables[t].length} rows`);
  }

  const willApply = args.apply && args.yes;
  if (!willApply) {
    console.log(
      "\nDry run only — nothing was written. Pass both --apply and --yes to actually restore " +
        "(this TRUNCATEs every table above against the current DATABASE_URL and re-inserts these rows).",
    );
    return;
  }

  console.log(
    `\n!!! Restoring into DATABASE_URL (${process.env.DATABASE_URL?.replace(/:[^:@]*@/, ":****@")}) in 5 seconds — Ctrl+C now to abort !!!`,
  );
  await new Promise((resolve) => setTimeout(resolve, 5000));

  await prisma.$transaction(
    async (tx) => {
      // Bypasses FK/trigger checks for the duration of this transaction, so
      // tables can be truncated and repopulated in any order instead of
      // needing to hand-derive a dependency order across ~80 tables. Scoped
      // to this transaction only (Postgres resets it at COMMIT/ROLLBACK).
      await tx.$executeRawUnsafe(`SET session_replication_role = replica`);

      for (const table of tableNames) {
        await tx.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
      }

      for (const table of tableNames) {
        const rows = backup.tables[table];
        if (rows.length === 0) continue;
        const columns = Object.keys(rows[0]);
        const columnList = columns.map((c) => `"${c}"`).join(", ");
        for (const row of rows) {
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
          const values = columns.map((c) => row[c]);
          await tx.$executeRawUnsafe(
            `INSERT INTO "${table}" (${columnList}) VALUES (${placeholders})`,
            ...values,
          );
        }
        console.log(`  restored ${rows.length} row(s) into "${table}"`);
      }
    },
    // A full restore across every table can run long — well past Prisma's
    // default 5s transaction timeout.
    { timeout: 30 * 60 * 1000, maxWait: 60_000 },
  );

  console.log("\nRestore complete.");
}

main()
  .catch((err) => {
    console.error("Restore failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
