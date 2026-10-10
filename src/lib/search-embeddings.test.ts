import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $executeRawUnsafe: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/post-visibility", () => ({ getListablePostsWhere: vi.fn() }));
vi.mock("@/lib/post-card-data", () => ({ postCardInclude: {}, attachViewerState: vi.fn() }));

import { Prisma } from "@/generated/prisma/client";
import { hnswEfSearch, nearestGroupIds, nearestPostIds } from "@/lib/search-embeddings";
import {
  EXPECTED_HNSW_INDEXES,
  MIGRATIONS_DIR,
  findHnswIndexProblems,
  readMigrations,
  replayHnswIndexes,
} from "../../scripts/check-migrations-no-hnsw-drop.mjs";

function render(call: unknown[]) {
  const [strings, ...values] = call as [readonly string[], ...unknown[]];
  const query = Prisma.sql(strings, ...values);
  return { sql: query.sql.replace(/\s+/g, " "), values: query.values };
}

describe("hnswEfSearch", () => {
  it("never goes below the floor for small limits", () => {
    expect(hnswEfSearch(5)).toBe(100);
  });

  it("gives search's 30-candidate queries eight times their limit", () => {
    expect(hnswEfSearch(30)).toBe(240);
  });

  it("caps at pgvector's maximum of 1000", () => {
    expect(hnswEfSearch(200)).toBe(1000);
    expect(hnswEfSearch(500)).toBe(1000);
  });

  it("returns null once the limit is more than half of the maximum", () => {
    expect(hnswEfSearch(501)).toBeNull();
  });
});

describe("nearest-neighbor query shapes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$queryRaw.mockImplementation((...call: unknown[]) => ({ kind: "query", ...render(call) }));
    db.$executeRawUnsafe.mockImplementation((sql: string) => ({ kind: "execute", sql }));
  });

  it("nearestPostIds runs one exact statement the HNSW index cannot serve", async () => {
    db.$queryRaw.mockResolvedValueOnce([
      { id: "near", distance: 0.5 },
      { id: "far", distance: 0.9 },
    ]);

    const ids = await nearestPostIds("[1,2]", { limit: 500, maxDistance: 0.82 });

    expect(ids).toEqual(["near"]);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
    const query = render(db.$queryRaw.mock.calls[0]);
    expect(query.sql).toContain('FROM "Post"');
    expect(query.sql).toContain("ORDER BY distance + 0 ASC");
    expect(query.values).toEqual(["[1,2]", 500]);
  });

  it("nearestGroupIds sets hnsw.ef_search in the same transaction as its query", async () => {
    db.$transaction.mockResolvedValueOnce([0, [{ id: "g1", distance: 0.2 }, { id: "g2", distance: 0.7 }]]);

    const ids = await nearestGroupIds("[1,2]");

    expect(ids).toEqual(["g1"]);
    const [statements] = db.$transaction.mock.calls[0] as [{ kind: string; sql: string; values?: unknown[] }[]];
    expect(statements).toHaveLength(2);
    expect(statements[0]).toEqual({ kind: "execute", sql: "SET LOCAL hnsw.ef_search = 240" });
    expect(statements[1].kind).toBe("query");
    expect(statements[1].sql).toContain('FROM "Conversation"');
    expect(statements[1].sql).toContain("ORDER BY distance ASC");
    expect(statements[1].values).toEqual(["[1,2]", 30]);
  });

  it("nearestGroupIds falls back to the exact statement when the limit is too large for HNSW", async () => {
    db.$queryRaw.mockResolvedValueOnce([{ id: "g1", distance: 0.2 }]);

    const ids = await nearestGroupIds("[1,2]", { limit: 600 });

    expect(ids).toEqual(["g1"]);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(render(db.$queryRaw.mock.calls[0]).sql).toContain("ORDER BY distance + 0 ASC");
  });
});

describe("pgvector HNSW migration guard", () => {
  const create = (index: string, table: string) =>
    `CREATE INDEX "${index}" ON "${table}" USING hnsw ("embedding" vector_cosine_ops);`;

  it("tracks creates and drops in migration-name order", () => {
    const result = replayHnswIndexes([
      { name: "3_restore", sql: `CREATE INDEX IF NOT EXISTS "A_idx" ON "A" USING hnsw ("embedding" vector_cosine_ops);` },
      { name: "1_add", sql: `${create("A_idx", "A")}\n${create("B_idx", "B")}` },
      { name: "2_drift", sql: `-- DropIndex\nDROP INDEX "A_idx";\n\n-- DropIndex\nDROP INDEX "B_idx";` },
    ]);
    expect(result).toEqual({ live: ["A_idx"], droppedBy: { B_idx: "2_drift" } });
  });

  it("ignores DROP INDEX mentioned only in a comment, and drops of ordinary indexes", () => {
    const result = replayHnswIndexes([
      { name: "1_add", sql: create("A_idx", "A") },
      {
        name: "2_other",
        sql: `-- Prisma generated a spurious "DROP INDEX" for A_idx here;\n/* DROP INDEX "A_idx"; */\nDROP INDEX "Message_conversationId_idx";`,
      },
    ]);
    expect(result).toEqual({ live: ["A_idx"], droppedBy: {} });
  });

  it("recognises IF EXISTS, CONCURRENTLY, schema-qualified and multi-index drops", () => {
    const result = replayHnswIndexes([
      { name: "1_add", sql: `${create("A_idx", "A")}${create("B_idx", "B")}${create("C_idx", "C")}` },
      { name: "2_drop", sql: `drop index concurrently if exists "public"."A_idx";\nDROP INDEX "B_idx", C_idx CASCADE;` },
    ]);
    expect(result.live).toEqual([]);
    expect(result.droppedBy).toEqual({ A_idx: "2_drop", B_idx: "2_drop", C_idx: "2_drop" });
  });

  it("names the offending migration for a dropped index", () => {
    const problems = findHnswIndexProblems(
      [
        { name: "1_add", sql: create("A_idx", "A") },
        { name: "2_drift", sql: `DROP INDEX "A_idx";` },
      ],
      ["A_idx"],
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("A_idx is dropped by migration 2_drift");
  });

  it("flags an expected index nothing creates and an HNSW index nobody listed", () => {
    const problems = findHnswIndexProblems([{ name: "1_add", sql: create("B_idx", "B") }], ["A_idx"]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("A_idx is never created");
    expect(problems[1]).toContain("B_idx is an HNSW index that is not listed");
  });

  it("passes for this repository's real migration history", () => {
    const migrations = readMigrations(MIGRATIONS_DIR);
    expect(findHnswIndexProblems(migrations)).toEqual([]);
    expect(replayHnswIndexes(migrations).live).toEqual(EXPECTED_HNSW_INDEXES);
  });

  it("would have caught the original drops", () => {
    const history = readMigrations(MIGRATIONS_DIR).filter(
      (m) => m.name < "20261010180000_restore_embedding_hnsw_indexes",
    );
    const problems = findHnswIndexProblems(history);
    expect(problems.join("\n")).toContain(
      "Post_embedding_hnsw_idx is dropped by migration 20260809133145_add_verification_email_sent_audit_action",
    );
    expect(problems.join("\n")).toContain(
      "Conversation_embedding_hnsw_idx is dropped by migration 20260817213557_add_post_shared_post_and_live_streaming",
    );
  });
});
