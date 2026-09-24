import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { prisma } from "@/lib/prisma";

/**
 * Automated encrypted database backups, uploaded to a dedicated, private R2
 * bucket — deliberately never the same bucket as src/lib/storage.ts's media
 * bucket, which is bound to a public URL (R2_PUBLIC_URL) that serves every
 * object under it to anyone. A full data dump here includes password
 * hashes, emails, and private message content, so it needs a bucket that is
 * never publicly readable, plus its own credentials (BACKUP_R2_*, not
 * R2_*) so a leaked media-upload key can't also read backups. The payload
 * is additionally encrypted client-side (AES-256-GCM, BACKUP_ENCRYPTION_KEY)
 * before it ever leaves this process — defense in depth in case the bucket
 * or its credentials are ever misconfigured.
 *
 * This is a logical (row-level JSON) backup, not a `pg_dump` binary dump —
 * there is no Postgres client-tools binary available in a Vercel/Netlify
 * serverless function. Schema is already fully version-controlled via
 * prisma/migrations (restorable with `prisma migrate deploy`), so only the
 * *data* needs to leave the database itself; see
 * scripts/restore-database-backup.ts for the corresponding restore path.
 */

const BACKUP_KEY_PREFIX = "backups/";
// Bounds worst-case memory/time for one run rather than every table getting
// an unbounded SELECT * — generous for this app's current scale. A table
// that hits this cap is still included (truncated, not skipped), and is
// logged so it's visible rather than silently incomplete.
const MAX_ROWS_PER_TABLE = 500_000;
const PAGE_SIZE = 10_000;
const DEFAULT_RETENTION_DAYS = 30;

export function isBackupConfigured() {
  return Boolean(
    (process.env.BACKUP_R2_ACCOUNT_ID || process.env.R2_ACCOUNT_ID) &&
      (process.env.BACKUP_R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID) &&
      (process.env.BACKUP_R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY) &&
      process.env.BACKUP_R2_BUCKET_NAME &&
      process.env.BACKUP_ENCRYPTION_KEY,
  );
}

let cachedClient: S3Client | null = null;

// Separate S3Client (and, ideally, separate credentials) from storage.ts's
// media client — see this file's own doc comment for why the two must
// never share a bucket. Falls back to the media R2_* credentials only if
// BACKUP_R2_ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY aren't set, so a
// minimal setup (one R2 API token, two buckets) still works; a stricter
// setup gives the backup bucket its own scoped-down token.
function client() {
  if (cachedClient) return cachedClient;
  const accountId = process.env.BACKUP_R2_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
  cachedClient = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: (process.env.BACKUP_R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID)!,
      secretAccessKey: (process.env.BACKUP_R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY)!,
    },
  });
  return cachedClient;
}

/** Every ordinary (non-system) table in the public schema, alphabetical for a deterministic run order. */
async function listTables(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  return rows.map((r) => r.tablename);
}

/** Nearly every model in schema.prisma uses a plain `id String @id @default(cuid())` — the rare exception (VerificationToken, a composite-key NextAuth table) falls back to an unpaginated dumpTable below instead. */
async function tableHasIdColumn(table: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'id'
     ) AS "exists"`,
    table,
  );
  return rows[0]?.exists ?? false;
}

/**
 * Keyset-paginated dump of one table (ORDER BY id + WHERE id > cursor) for
 * the common case of a plain cuid() id column — cuid()s aren't
 * chronologically sortable, but that's not needed here: this only requires
 * a stable total order to page through every row exactly once, which any
 * unique column ordering provides. A table with no `id` column at all
 * (checked via tableHasIdColumn) falls back to one unpaginated SELECT *,
 * capped at MAX_ROWS_PER_TABLE same as the paginated path — acceptable
 * since every such table in this schema is a small, low-value one (e.g.
 * VerificationToken, whose rows expire within minutes anyway). Table names
 * interpolated directly into SQL here are always trusted — sourced only
 * from pg_tables/information_schema in listTables/tableHasIdColumn, never
 * from user input.
 */
async function dumpTable(table: string): Promise<Record<string, unknown>[]> {
  if (!(await tableHasIdColumn(table))) {
    return prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM "${table}" LIMIT $1`,
      MAX_ROWS_PER_TABLE,
    );
  }

  const rows: Record<string, unknown>[] = [];
  let cursor: string | null = null;
  for (;;) {
    if (rows.length >= MAX_ROWS_PER_TABLE) {
      console.error(`[db-backup] table "${table}" hit MAX_ROWS_PER_TABLE (${MAX_ROWS_PER_TABLE}) — dump truncated`);
      break;
    }
    const take = Math.min(PAGE_SIZE, MAX_ROWS_PER_TABLE - rows.length);
    const page: Record<string, unknown>[] = cursor
      ? await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM "${table}" WHERE "id" > $1 ORDER BY "id" ASC LIMIT $2`,
          cursor,
          take,
        )
      : await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM "${table}" ORDER BY "id" ASC LIMIT $1`,
          take,
        );
    if (page.length === 0) break;
    rows.push(...page);
    cursor = String(page[page.length - 1].id);
    if (page.length < take) break;
  }
  return rows;
}

/** JSON.stringify can't represent these natively — round-tripped back to their real type by restore-database-backup.ts's matching reviver. */
function jsonReplacer(_key: string, value: unknown) {
  if (typeof value === "bigint") return { __type__: "bigint", value: value.toString() };
  if (value instanceof Date) return { __type__: "date", value: value.toISOString() };
  if (Buffer.isBuffer(value)) return { __type__: "buffer", value: value.toString("base64") };
  return value;
}

const GCM_IV_BYTES = 12;

/** AES-256-GCM, keyed by SHA-256(BACKUP_ENCRYPTION_KEY) — output layout: [iv(12)][authTag(16)][ciphertext]. */
function encrypt(plaintext: Buffer): Buffer {
  const key = createHash("sha256").update(process.env.BACKUP_ENCRYPTION_KEY!).digest();
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

/** Inverse of encrypt() — exported for restore-database-backup.ts. */
function decrypt(blob: Buffer): Buffer {
  const key = createHash("sha256").update(process.env.BACKUP_ENCRYPTION_KEY!).digest();
  const iv = blob.subarray(0, GCM_IV_BYTES);
  const authTag = blob.subarray(GCM_IV_BYTES, GCM_IV_BYTES + 16);
  const ciphertext = blob.subarray(GCM_IV_BYTES + 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function pruneOldBackups(bucket: string) {
  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS);
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  let continuationToken: string | undefined;
  let deleted = 0;
  do {
    const listed = await client().send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: BACKUP_KEY_PREFIX, ContinuationToken: continuationToken }),
    );
    const stale = (listed.Contents ?? []).filter(
      (o): o is typeof o & { Key: string } => Boolean(o.Key) && Boolean(o.LastModified) && o.LastModified!.getTime() < cutoff,
    );
    for (const obj of stale) {
      await client().send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
      deleted += 1;
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);

  return deleted;
}

export type BackupResult = {
  key: string;
  tableCount: number;
  totalRows: number;
  bytes: number;
  prunedCount: number;
};

/** Dumps every table, encrypts the result, and uploads it to the backup bucket — see this file's own doc comment for the full design/threat model. */
export async function runDatabaseBackup(): Promise<BackupResult> {
  if (!isBackupConfigured()) {
    throw new Error("not_configured");
  }

  const tables = await listTables();
  const dump: Record<string, Record<string, unknown>[]> = {};
  let totalRows = 0;

  for (const table of tables) {
    // Prisma's own migration-history table — schema is already tracked in
    // git via prisma/migrations, so this adds nothing a restore needs.
    if (table === "_prisma_migrations") continue;
    const rows = await dumpTable(table);
    dump[table] = rows;
    totalRows += rows.length;
  }

  const payload = JSON.stringify({ createdAt: new Date().toISOString(), tables: dump }, jsonReplacer);
  const encrypted = encrypt(gzipSync(Buffer.from(payload, "utf-8")));

  const bucket = process.env.BACKUP_R2_BUCKET_NAME!;
  const key = `${BACKUP_KEY_PREFIX}yukon3t-${new Date().toISOString().replace(/[:.]/g, "-")}.json.gz.enc`;

  await client().send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: encrypted, ContentType: "application/octet-stream" }),
  );

  const prunedCount = await pruneOldBackups(bucket);

  return { key, tableCount: tables.length, totalRows, bytes: encrypted.byteLength, prunedCount };
}

/** Downloads and decrypts one backup by key — used by restore-database-backup.ts. */
export async function fetchBackup(key: string): Promise<{ createdAt: string; tables: Record<string, Record<string, unknown>[]> }> {
  const bucket = process.env.BACKUP_R2_BUCKET_NAME!;
  const res = await client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const encrypted = Buffer.from(await res.Body!.transformToByteArray());
  const decrypted = gunzipSync(decrypt(encrypted));
  return JSON.parse(decrypted.toString("utf-8"), (_key, value) => {
    if (value && typeof value === "object" && "__type__" in value) {
      const v = value as { __type__: string; value: string };
      if (v.__type__ === "bigint") return BigInt(v.value);
      if (v.__type__ === "date") return new Date(v.value);
      if (v.__type__ === "buffer") return Buffer.from(v.value, "base64");
    }
    return value;
  });
}

/** Lists available backups (newest first) — used by restore-database-backup.ts's interactive picker. */
export async function listBackups(): Promise<{ key: string; lastModified: Date; size: number }[]> {
  const bucket = process.env.BACKUP_R2_BUCKET_NAME!;
  const listed = await client().send(new ListObjectsV2Command({ Bucket: bucket, Prefix: BACKUP_KEY_PREFIX }));
  return (listed.Contents ?? [])
    .filter((o): o is typeof o & { Key: string; LastModified: Date; Size: number } => Boolean(o.Key))
    .map((o) => ({ key: o.Key, lastModified: o.LastModified ?? new Date(0), size: o.Size ?? 0 }))
    .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}
