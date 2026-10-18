// Stage 2 of private profile pictures (see CLAUDE.md "Profile pictures" and src/lib/avatar-url.ts): copies every
// existing PUBLIC avatar (User.avatarUrl = `${R2_PUBLIC_URL}/avatar/<userId>/<uuid>.<ext>`) into the private avatar
// bucket (R2_AVATAR_BUCKET_NAME) under the SAME key, then rewrites User.avatarUrl to the route form
// `/api/avatar/<userId>/<uuid>.<ext>`.
//
// What it does NOT do:
// - It never deletes or changes the public objects. They stay where they are (and keep working at their old URL)
//   until Stage 3, so scripts/revert-avatars-public.ts can put any row back exactly as it was.
// - It does not make a thumbnail + full-size pair. That needs decoding and re-encoding the image, and this app
//   deliberately never decodes untrusted images on a server (no sharp/libvips, see SECURITY.md). A migrated avatar is
//   one image used for both sizes (the route's single-image form); only pictures uploaded after AVATAR_PRIVATE is on
//   get a ~320px thumbnail with the full size limited to the owner and their connections. Those older pictures were
//   already resized client-side to at most 1920px when uploaded.
// - It skips (and lists) any avatarUrl that isn't exactly one of this app's own public avatar URLs for that same user
//   (another host, another kind's key, someone else's key): those rows are left untouched.
//
// Safe to re-run: a row already in route form no longer matches, an object already copied is not copied again, and
// each row is rewritten with a guarded update (only if avatarUrl is still the URL that was read), so a user who
// changes their picture mid-run is simply skipped. Every rewritten row is appended to the mapping file (old -> new)
// after each batch, so a crash leaves a complete record of what was changed; an existing mapping file is merged into,
// never overwritten.
//
// Usage (needs the production env: DATABASE_URL, R2_* and R2_AVATAR_BUCKET_NAME):
//   npx tsx scripts/migrate-avatars-private.ts
//     Dry run (the default): reports what would be copied/rewritten. Touches nothing.
//   npx tsx scripts/migrate-avatars-private.ts --apply [--limit 20] [--batch 50] [--out ./avatar-migration-map.json]
//     Copies and rewrites. --limit stops after that many rows (use a small first run and check the app);
//     --out is the mapping file (default ./avatar-migration-map.json; keep it until Stage 3 is done).
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import {
  downloadObject,
  headAvatarObject,
  isAvatarBucketConfigured,
  isStorageConfigured,
  keyFromPublicUrl,
  putAvatarObject,
  validateContentType,
} from "@/lib/storage";
import { routeUrlForPublicAvatarKey } from "@/lib/avatar-url";

// Same shape scripts/revert-avatars-public.ts reads (kept as two copies: importing this script would run it).
type AvatarMigrationEntry ={ userId: string; oldUrl: string; newUrl: string; migratedAt: string };

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function parseArgs(argv: string[]) {
  const limit = Number(argValue(argv, "--limit") ?? Infinity);
  const batch = Number(argValue(argv, "--batch") ?? 50);
  return {
    apply: argv.includes("--apply"),
    limit: Number.isFinite(limit) && limit > 0 ? limit : Infinity,
    batch: Number.isInteger(batch) && batch > 0 && batch <= 500 ? batch : 50,
    out: argValue(argv, "--out") ?? "./avatar-migration-map.json",
  };
}

function loadMapping(path: string): AvatarMigrationEntry[] {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${path} is not a mapping file (expected a JSON array)`);
  return parsed as AvatarMigrationEntry[];
}

function saveMapping(path: string, entries: AvatarMigrationEntry[]) {
  writeFileSync(path, `${JSON.stringify(entries, null, 2)}\n`);
}

async function main() {
  const { apply, limit, batch, out } = parseArgs(process.argv.slice(2));

  if (!isStorageConfigured()) {
    throw new Error("R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME / R2_PUBLIC_URL must be set.");
  }
  if (apply && !isAvatarBucketConfigured()) {
    throw new Error("R2_AVATAR_BUCKET_NAME must be set (and the bucket created) before --apply.");
  }

  const publicAvatarPrefix = `${process.env.R2_PUBLIC_URL!.replace(/\/$/, "")}/avatar/`;
  const mapping = apply ? loadMapping(out) : [];
  const alreadyMapped = new Set(mapping.map((m) => m.userId));

  let lastId: string | undefined;
  let scanned = 0;
  let migrated = 0;
  let copied = 0;
  const skipped: { userId: string; avatarUrl: string; reason: string }[] = [];

  while (scanned < limit) {
    const rows = await prisma.user.findMany({
      where: { avatarUrl: { startsWith: publicAvatarPrefix }, ...(lastId ? { id: { gt: lastId } } : {}) },
      select: { id: true, avatarUrl: true },
      orderBy: { id: "asc" },
      take: Math.min(batch, limit - scanned),
    });
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1].id;

    for (const row of rows) {
      scanned += 1;
      const oldUrl = row.avatarUrl!;
      const key = keyFromPublicUrl(oldUrl);
      const mapped = key ? routeUrlForPublicAvatarKey(key) : null;
      if (!key || !mapped) {
        skipped.push({ userId: row.id, avatarUrl: oldUrl, reason: "not an avatar upload key" });
        continue;
      }
      if (mapped.ownerId !== row.id) {
        skipped.push({ userId: row.id, avatarUrl: oldUrl, reason: "key belongs to another user" });
        continue;
      }

      if (!apply) {
        console.log(`[dry run] ${row.id}: would copy ${key} and set avatarUrl to ${mapped.routeUrl}`);
        migrated += 1;
        continue;
      }

      try {
        const existing = await headAvatarObject(key);
        if (!existing || existing.size === 0) {
          const object = await downloadObject(key);
          if (!object || object.body.byteLength === 0) {
            skipped.push({ userId: row.id, avatarUrl: oldUrl, reason: "public object missing or empty" });
            continue;
          }
          if (!validateContentType("avatar", object.contentType)) {
            skipped.push({ userId: row.id, avatarUrl: oldUrl, reason: `unexpected content type ${object.contentType}` });
            continue;
          }
          await putAvatarObject(key, object.body, object.contentType);
          const check = await headAvatarObject(key);
          if (!check || check.size !== object.body.byteLength) {
            skipped.push({ userId: row.id, avatarUrl: oldUrl, reason: "copy could not be verified" });
            continue;
          }
          copied += 1;
        }

        const updated = await prisma.user.updateMany({
          where: { id: row.id, avatarUrl: oldUrl },
          data: { avatarUrl: mapped.routeUrl },
        });
        if (updated.count !== 1) {
          skipped.push({ userId: row.id, avatarUrl: oldUrl, reason: "avatar changed during the run" });
          continue;
        }
        if (!alreadyMapped.has(row.id)) {
          mapping.push({ userId: row.id, oldUrl, newUrl: mapped.routeUrl, migratedAt: new Date().toISOString() });
          alreadyMapped.add(row.id);
        }
        migrated += 1;
        console.log(`${row.id}: ${oldUrl} -> ${mapped.routeUrl}`);
      } catch (err) {
        skipped.push({ userId: row.id, avatarUrl: oldUrl, reason: `error: ${(err as Error).message}` });
      }
    }

    if (apply) saveMapping(out, mapping);
  }

  const others = await prisma.user.count({
    where: {
      avatarUrl: { not: null },
      NOT: [{ avatarUrl: { startsWith: publicAvatarPrefix } }, { avatarUrl: { startsWith: "/api/avatar/" } }],
    },
  });

  console.log(
    `\n${apply ? "Done." : "Dry run complete: nothing was changed."} Scanned ${scanned} public avatar(s); ` +
      `${migrated} ${apply ? "moved to the private bucket" : "would be moved"}` +
      (apply ? ` (${copied} object(s) copied, the rest were already there)` : "") +
      `; ${skipped.length} skipped.`,
  );
  for (const s of skipped) console.log(`  skipped ${s.userId}: ${s.reason} (${s.avatarUrl})`);
  if (others > 0) {
    console.log(`${others} user(s) have an avatarUrl that is neither a public avatar nor the route form; left as they are.`);
  }
  if (apply) console.log(`Mapping (old -> new, ${mapping.length} row(s) in total) written to ${out}. Keep it until Stage 3.`);
  else if (migrated > 0) console.log("Re-run with --apply to perform this.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
