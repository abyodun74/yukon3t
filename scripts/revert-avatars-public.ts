// Undoes scripts/migrate-avatars-private.ts from its mapping file(s): puts each listed user's avatarUrl back to the
// public URL it had before. Only possible until Stage 3 deletes the public copies, which is why that stage waits.
//
// A row is restored only if its avatarUrl is still exactly the route form the migration wrote (a guarded update): a
// user who has since uploaded a new picture keeps it, and is listed. It also checks that the old public URL still
// answers before restoring it, so nobody is pointed at a deleted file. The private copies are left in place (they
// are harmless, and a later migration run reuses them).
//
// Usage (production env: DATABASE_URL):
//   npx tsx scripts/revert-avatars-public.ts --in ./avatar-migration-map.json [--in another.json]
//     Dry run (the default): reports what would be restored. Touches nothing.
//   npx tsx scripts/revert-avatars-public.ts --in ./avatar-migration-map.json --apply
//     Restores. Turn AVATAR_PRIVATE off first if new uploads should go back to public too.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";

// Same shape scripts/migrate-avatars-private.ts writes.
type AvatarMigrationEntry = { userId: string; oldUrl: string; newUrl: string; migratedAt: string };

function parseArgs(argv: string[]) {
  const inputs: string[] = [];
  argv.forEach((arg, i) => {
    if (arg === "--in" && argv[i + 1]) inputs.push(argv[i + 1]);
  });
  return { apply: argv.includes("--apply"), inputs };
}

async function publicUrlStillServes(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const { apply, inputs } = parseArgs(process.argv.slice(2));
  if (inputs.length === 0) throw new Error("Pass the mapping file written by migrate-avatars-private.ts: --in <path>");

  const entries = new Map<string, AvatarMigrationEntry>();
  for (const path of inputs) {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(parsed)) throw new Error(`${path} is not a mapping file (expected a JSON array)`);
    for (const e of parsed as AvatarMigrationEntry[]) {
      if (typeof e?.userId !== "string" || typeof e.oldUrl !== "string" || typeof e.newUrl !== "string") {
        throw new Error(`${path} has a malformed entry: ${JSON.stringify(e)}`);
      }
      if (!e.oldUrl.startsWith("https://") || !e.newUrl.startsWith("/api/avatar/")) {
        throw new Error(`${path} has an unexpected entry: ${JSON.stringify(e)}`);
      }
      // The first record for a user is the original public URL.
      if (!entries.has(e.userId)) entries.set(e.userId, e);
    }
  }

  let restored = 0;
  const skipped: { userId: string; reason: string }[] = [];
  for (const e of entries.values()) {
    if (!(await publicUrlStillServes(e.oldUrl))) {
      skipped.push({ userId: e.userId, reason: `public copy no longer answers (${e.oldUrl})` });
      continue;
    }
    if (!apply) {
      const current = await prisma.user.findUnique({ where: { id: e.userId }, select: { avatarUrl: true } });
      if (current?.avatarUrl !== e.newUrl) {
        skipped.push({ userId: e.userId, reason: "avatar changed since the migration" });
        continue;
      }
      console.log(`[dry run] ${e.userId}: would restore ${e.oldUrl}`);
      restored += 1;
      continue;
    }
    const updated = await prisma.user.updateMany({
      where: { id: e.userId, avatarUrl: e.newUrl },
      data: { avatarUrl: e.oldUrl },
    });
    if (updated.count !== 1) {
      skipped.push({ userId: e.userId, reason: "avatar changed since the migration" });
      continue;
    }
    restored += 1;
    console.log(`${e.userId}: ${e.newUrl} -> ${e.oldUrl}`);
  }

  console.log(
    `\n${apply ? "Done." : "Dry run complete: nothing was changed."} ${restored} of ${entries.size} row(s) ` +
      `${apply ? "restored" : "would be restored"}; ${skipped.length} skipped.`,
  );
  for (const s of skipped) console.log(`  skipped ${s.userId}: ${s.reason}`);
  if (!apply && restored > 0) console.log("Re-run with --apply to perform this.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
