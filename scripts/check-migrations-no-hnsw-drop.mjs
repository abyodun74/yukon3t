// Drift guard for the pgvector HNSW indexes on the "embedding" columns.
//
// schema.prisma cannot express these indexes (the columns are
// Unsupported("vector(1536)") and Prisma has no Hnsw index type), so
// `prisma migrate dev` treats them as drift and writes a "DROP INDEX" for
// each one into the next migration it generates. That silently removed all
// of them once already (see
// prisma/migrations/20261010180000_restore_embedding_hnsw_indexes).
//
// This replays every migration file in order — no database needed — and
// fails unless the HNSW indexes left standing at the end are exactly
// EXPECTED_HNSW_INDEXES. It runs from scripts/migrate-if-production.sh
// (before `prisma migrate deploy`, on every build) and from `npm test`
// (src/lib/search-embeddings.test.ts).
//
// If it fails on a migration you just generated: delete the "DROP INDEX"
// lines for the embedding indexes from that migration.sql. To add or remove
// an HNSW index on purpose, change EXPECTED_HNSW_INDEXES in the same commit
// — and read src/lib/search-embeddings.ts first: a query that hits an HNSW
// index returns at most hnsw.ef_search rows (default 40) whatever its LIMIT.
//
// Not detected: an index removed implicitly by DROP TABLE / DROP COLUMN.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// User_embedding_hnsw_idx is deliberately absent — see the restore
// migration's own comment (presence heartbeat write cost).
export const EXPECTED_HNSW_INDEXES = [
  "Circle_embedding_hnsw_idx",
  "CollabBoardPost_embedding_hnsw_idx",
  "Conversation_embedding_hnsw_idx",
  "Post_embedding_hnsw_idx",
];

const CREATE_HNSW_INDEX =
  /^CREATE\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(\S+)\s+ON\s[\s\S]*\bUSING\s+hnsw\b/i;
const DROP_INDEX = /^DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?([\s\S]+)$/i;

function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
}

function indexName(identifier) {
  return identifier.trim().split(".").pop().replace(/"/g, "");
}

/**
 * @param {{ name: string, sql: string }[]} migrations
 * @returns {{ live: string[], droppedBy: Record<string, string> }} the HNSW
 * indexes that exist after applying every migration in name order, and, for
 * each one that was created and later dropped, the migration that dropped it.
 */
export function replayHnswIndexes(migrations) {
  const live = new Set();
  const droppedBy = {};
  const ordered = [...migrations].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const { name, sql } of ordered) {
    for (const statement of stripSqlComments(sql).split(";")) {
      const trimmed = statement.trim();
      const created = CREATE_HNSW_INDEX.exec(trimmed);
      if (created) {
        const index = indexName(created[1]);
        live.add(index);
        delete droppedBy[index];
        continue;
      }
      const dropped = DROP_INDEX.exec(trimmed);
      if (!dropped) continue;
      const targets = dropped[1].replace(/\s+(CASCADE|RESTRICT)\s*$/i, "").split(",");
      for (const target of targets) {
        const index = indexName(target);
        if (live.delete(index)) droppedBy[index] = name;
      }
    }
  }
  return { live: [...live].sort(), droppedBy };
}

/**
 * @param {{ name: string, sql: string }[]} migrations
 * @param {string[]} [expected]
 * @returns {string[]} one human-readable problem per line; empty when the
 * migration history leaves exactly the expected HNSW indexes in place.
 */
export function findHnswIndexProblems(migrations, expected = EXPECTED_HNSW_INDEXES) {
  const { live, droppedBy } = replayHnswIndexes(migrations);
  const problems = [];
  for (const index of expected) {
    if (live.includes(index)) continue;
    problems.push(
      droppedBy[index]
        ? `${index} is dropped by migration ${droppedBy[index]} — delete that DROP INDEX line (Prisma generates it because schema.prisma cannot express HNSW indexes).`
        : `${index} is never created by any migration.`,
    );
  }
  for (const index of live) {
    if (expected.includes(index)) continue;
    problems.push(
      `${index} is an HNSW index that is not listed in EXPECTED_HNSW_INDEXES (scripts/check-migrations-no-hnsw-drop.mjs).`,
    );
  }
  return problems;
}

/** @returns {{ name: string, sql: string }[]} */
export function readMigrations(migrationsDir) {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, file: path.join(migrationsDir, entry.name, "migration.sql") }))
    .filter(({ file }) => existsSync(file))
    .map(({ name, file }) => ({ name, sql: readFileSync(file, "utf8") }));
}

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "prisma", "migrations");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = findHnswIndexProblems(readMigrations(MIGRATIONS_DIR));
  if (problems.length > 0) {
    console.error("pgvector HNSW index check failed (scripts/check-migrations-no-hnsw-drop.mjs):");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`pgvector HNSW index check passed (${EXPECTED_HNSW_INDEXES.length} indexes).`);
}
