// Stage 3 of private profile pictures (see CLAUDE.md "Profile pictures"): deletes the old PUBLIC copies of profile
// pictures, the objects under the public bucket's (R2_BUCKET_NAME) `avatar/` prefix. The 2026-10-19 backfill
// (Stage 2) copied each one to the private avatar bucket (R2_AVATAR_BUCKET_NAME) under the same key and rewrote
// User.avatarUrl to the route form, but left the public objects in place, so their old URLs still work for anyone
// who has one. This removes them.
//
// An object is deleted only if ALL of these hold (rules in src/lib/public-avatar-cleanup.ts, unit-tested):
// - its key is exactly an avatar key this app minted: `avatar/<ownerId>/<uuid>.<jpg|png|webp>`;
// - the private avatar bucket has a copy under the same key, non-empty and the same size;
// - no text/varchar/json/text[] column of any table in the database contains the key, except as part of its own
//   route form (`/api/avatar/<key-without-"avatar/">`, served from the private copy). That covers User.avatarUrl and
//   any other place that ever copied an avatar URL (notifications, messages, posts, etc.);
// - if the mapping file from the backfill (avatar-migration-map.json) lists it, the mapping agrees with the key.
// Anything else is skipped and listed with the reason, never deleted. --apply is refused outright while any user's
// avatarUrl still points at the public bucket's avatar/ prefix (the backfill would not be finished).
//
// Usage (needs the PRODUCTION env: DATABASE_URL, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
// R2_BUCKET_NAME, R2_PUBLIC_URL, R2_AVATAR_BUCKET_NAME; values already set in the shell win over .env):
//   npx tsx scripts/delete-public-avatars.ts
//     Dry run (the default): lists and verifies, reports counts. Deletes nothing.
//   npx tsx scripts/delete-public-avatars.ts --apply [--limit 5] [--batch 10] [--map ./avatar-migration-map.json]
//     Deletes the verified objects, --batch at a time (default 10, max 100), at most --limit of them, then checks
//     each one is really gone. Safe to re-run: a deleted object is no longer listed.
// Prints keys, counts and reasons only: never credentials, bucket names or connection strings.
import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { headAvatarObject, isAvatarBucketConfigured, isStorageConfigured } from "@/lib/storage";
import {
  parseAvatarMigrationMap,
  verifyPublicAvatarForDeletion,
  type AvatarMigrationEntry,
  type PrivateCopy,
  type PublicAvatarVerdict,
} from "@/lib/public-avatar-cleanup";

const PREFIX = "avatar/";

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function parseArgs(argv: string[]) {
  const limit = Number(argValue(argv, "--limit") ?? Infinity);
  const batch = Number(argValue(argv, "--batch") ?? 10);
  return {
    apply: argv.includes("--apply"),
    limit: Number.isInteger(limit) && limit > 0 ? limit : Infinity,
    batch: Number.isInteger(batch) && batch > 0 && batch <= 100 ? batch : 10,
    map: argValue(argv, "--map") ?? "./avatar-migration-map.json",
  };
}

// The public bucket, with the same client settings as src/lib/storage.ts (whose client is module-private).
function publicBucketClient() {
  return new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT ?? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  });
}

const errorText = (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message}` : "unknown error");

async function listPublicAvatars(s3: S3Client, bucket: string) {
  const objects: { key: string; size: number }[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: PREFIX, ContinuationToken: token }));
    for (const o of page.Contents ?? []) if (o.Key) objects.push({ key: o.Key, size: o.Size ?? 0 });
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * key -> the "Table"."column" places that contain it, other than inside its own route form. Every text-like column of
 * every table in the current schema is scanned (only rows containing "avatar/" are compared key by key).
 */
async function findReferences(keys: string[]): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  if (keys.length === 0) return found;
  const columns = await prisma.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
    `SELECT c.table_name, c.column_name
       FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = current_schema()
        AND t.table_type = 'BASE TABLE'
        AND c.table_name <> '_prisma_migrations'
        AND (c.data_type IN ('text', 'character varying', 'json', 'jsonb')
             OR (c.data_type = 'ARRAY' AND c.udt_name IN ('_text', '_varchar')))
      ORDER BY c.table_name, c.column_name`,
  );
  for (const { table_name, column_name } of columns) {
    const col = `t.${quoteIdent(column_name)}::text`;
    const rows = await prisma.$queryRawUnsafe<{ key: string }[]>(
      `SELECT DISTINCT k.key
         FROM ${quoteIdent(table_name)} AS t
        CROSS JOIN unnest($1::text[]) AS k(key)
        WHERE strpos(${col}, 'avatar/') > 0
          AND strpos(replace(${col}, '/api/' || k.key, ''), k.key) > 0`,
      keys,
    );
    for (const { key } of rows) found.set(key, [...(found.get(key) ?? []), `${quoteIdent(table_name)}.${quoteIdent(column_name)}`]);
  }
  console.log(`Scanned ${columns.length} text column(s) for references.`);
  return found;
}

async function privateCopyOf(key: string): Promise<PrivateCopy> {
  try {
    return await headAvatarObject(key);
  } catch {
    return "error";
  }
}

async function publicObjectGone(s3: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return false;
  } catch (err) {
    return (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404;
  }
}

async function main() {
  const { apply, limit, batch, map } = parseArgs(process.argv.slice(2));

  if (!isStorageConfigured()) {
    throw new Error("R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME / R2_PUBLIC_URL must be set.");
  }
  if (!isAvatarBucketConfigured()) {
    throw new Error("R2_AVATAR_BUCKET_NAME must be set: every public avatar is checked against its private copy.");
  }
  const bucket = process.env.R2_BUCKET_NAME!;
  const s3 = publicBucketClient();

  let mapping = new Map<string, AvatarMigrationEntry>();
  if (existsSync(map)) {
    mapping = parseAvatarMigrationMap(JSON.parse(readFileSync(map, "utf8")));
    console.log(`Mapping file: ${mapping.size} migrated avatar(s) listed.`);
  } else {
    console.log("No mapping file found: verifying by the key scheme, the private copy and the database only.");
  }

  const publicAvatarUrlPrefix = `${process.env.R2_PUBLIC_URL!.replace(/\/$/, "")}/${PREFIX}`;
  const usersOnPublic = await prisma.user.count({ where: { avatarUrl: { startsWith: publicAvatarUrlPrefix } } });

  const objects = await listPublicAvatars(s3, bucket);
  console.log(`Public bucket: ${objects.length} object(s) under ${PREFIX}`);

  const references = await findReferences(objects.map((o) => o.key));
  const verdicts: PublicAvatarVerdict[] = [];
  for (const o of objects) {
    verdicts.push(
      verifyPublicAvatarForDeletion({
        key: o.key,
        publicSize: o.size,
        privateCopy: await privateCopyOf(o.key),
        referencedBy: references.get(o.key) ?? [],
        mappingEntry: mapping.get(o.key),
      }),
    );
  }
  const deletable = verdicts.filter((v): v is Extract<PublicAvatarVerdict, { deletable: true }> => v.deletable);
  const skipped = verdicts.filter((v): v is Extract<PublicAvatarVerdict, { deletable: false }> => !v.deletable);
  const listed = new Set(objects.map((o) => o.key));
  const mappingGone = [...mapping.keys()].filter((k) => !listed.has(k)).length;

  console.log(
    `\nVerified deletable: ${deletable.length} (${deletable.filter((d) => d.inMapping).length} listed in the mapping file).` +
      `\nSkipped: ${skipped.length}.` +
      `\nMapping entries whose public object is already gone: ${mappingGone}.` +
      `\nUsers whose avatarUrl still points at the public bucket: ${usersOnPublic}.`,
  );
  for (const s of skipped) console.log(`  skipped ${s.key}: ${s.reason}`);

  if (!apply) {
    for (const d of deletable.slice(0, limit)) console.log(`  [dry run] would delete ${d.key}`);
    console.log("\nDry run complete: nothing was deleted." + (deletable.length > 0 ? " Re-run with --apply to delete." : ""));
    return;
  }
  if (usersOnPublic > 0) {
    throw new Error(`Refusing --apply: ${usersOnPublic} user(s) still have a public avatar URL. Finish the backfill first.`);
  }

  const toDelete = deletable.slice(0, limit);
  let deleted = 0;
  const failed: { key: string; reason: string }[] = [];
  for (let i = 0; i < toDelete.length; i += batch) {
    await Promise.all(
      toDelete.slice(i, i + batch).map(async ({ key }) => {
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        } catch (err) {
          failed.push({ key, reason: errorText(err) });
          return;
        }
        if (await publicObjectGone(s3, bucket, key)) {
          deleted += 1;
          console.log(`  deleted ${key}`);
        } else {
          failed.push({ key, reason: "still present after the delete" });
        }
      }),
    );
  }

  console.log(`\nDone. Deleted ${deleted} of ${toDelete.length} verified object(s); ${failed.length} failed.`);
  for (const f of failed) console.log(`  failed ${f.key}: ${f.reason}`);
  if (deletable.length > toDelete.length) {
    console.log(`${deletable.length - toDelete.length} verified object(s) left for a later run (--limit).`);
  }
}

main()
  .catch((err) => {
    console.error(errorText(err));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
