import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Migration 20261120120000_like_groups_same_author regroups like groups same-author only (like-groups.ts) and recounts.
// It runs during the Netlify build against production (Neon), so its shape is pinned here: data only, re-runnable,
// author equality on every edge, and likes deleted only through the provable-backfill-copy table.

const NAME = "20261120120000_like_groups_same_author";
const dir = path.join(process.cwd(), "prisma/migrations");
const sql = readFileSync(path.join(dir, NAME, "migration.sql"), "utf8");
const code = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe(`migration ${NAME}`, () => {
  it("comes after the original like-groups migration", () => {
    const names = readdirSync(dir).filter((n) => /^\d{14}_/.test(n)).sort();
    expect(names.indexOf(NAME)).toBeGreaterThan(names.indexOf("20261119130000_like_groups"));
  });

  it("changes no schema and touches no index", () => {
    expect(code).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(code).not.toMatch(/\bDROP\s+(INDEX|COLUMN|CONSTRAINT)\b/i);
    expect(code).not.toMatch(/\bCREATE\s+(UNIQUE\s+)?INDEX\b/i);
    expect(code).not.toMatch(/\bTRUNCATE\b/i);
    expect(code).not.toMatch(/hnsw/i);
  });

  it("creates and drops only its own temp tables, guarded so a re-run works", () => {
    const creates = [...code.matchAll(/CREATE\s+(\w+\s+)?TABLE\s+("[^"]+")/gi)];
    expect(creates.length).toBeGreaterThan(0);
    for (const m of creates) {
      expect(m[1]?.trim().toUpperCase()).toBe("TEMP");
      expect(m[2]).toMatch(/^"_lgsa_/);
    }
    const drops = [...code.matchAll(/DROP\s+TABLE\s+(IF\s+EXISTS\s+)?("[^"]+")/gi)];
    for (const m of drops) {
      expect(m[1]).toBeTruthy();
      expect(m[2]).toMatch(/^"_lgsa_/);
    }
    // Every temp table created is dropped before the end.
    for (const m of creates) expect(drops.filter((d) => d[2] === m[2]).length).toBe(2);
  });

  it("links two items only when they have the same author", () => {
    const edges = code.slice(code.indexOf("WITH RECURSIVE edges"), code.indexOf("undirected AS"));
    const selects = edges.split(/\bUNION\b/i);
    expect(selects).toHaveLength(2);
    for (const s of selects) expect(s).toContain('p."authorId" = m."authorId"');
  });

  it("deletes likes only through the provable-backfill-copy table", () => {
    const deletes = [...code.matchAll(/DELETE\s+FROM\s+("[^"]+")[^;]*;/gi)];
    expect(deletes.map((d) => d[1]).sort()).toEqual(['"Like"', '"MuseReaction"']);
    for (const d of deletes) expect(d[0]).toContain('USING "_lgsa_artifacts"');
    const artifacts = code.slice(code.indexOf('CREATE TEMP TABLE "_lgsa_artifacts"'), code.indexOf('DELETE FROM "Like"'));
    // Only the backfill's shape (a Like or a heart), only inside that migration's recorded run.
    expect(artifacts).toContain("c.is_copy_shape");
    expect(artifacts).toContain('FROM "_lgsa_window" w WHERE c.created_at BETWEEN w.lo AND w.hi');
    expect(code).toContain("migration_name = '20261119130000_like_groups'");
    expect(code).toContain("to_regclass('\"_prisma_migrations\"')");
  });

  it("recounts every item it touched from the rows", () => {
    expect(code).toMatch(/UPDATE "Post" p\s+SET "likeCount" = \(SELECT COUNT\(\*\) FROM "_lgsa_group_likers"/);
    expect(code).toMatch(/UPDATE "Muse" m\s+SET "likeCount" = \(SELECT COUNT\(\*\) FROM "_lgsa_group_likers"/);
    expect(code).toMatch(/UPDATE "Post" p\s+SET "likeCount" = \(SELECT COUNT\(\*\) FROM "Like" l/);
    expect(code).toMatch(/UPDATE "Muse" m\s+SET "likeCount" = \(SELECT COUNT\(\*\) FROM "MuseReaction" r/);
  });
});
