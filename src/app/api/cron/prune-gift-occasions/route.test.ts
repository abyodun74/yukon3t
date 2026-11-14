import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SELF_OCCASION_COOLDOWN_MS } from "@/lib/gift-occasions";

// The prune-gift-occasions cron: bearer-authenticated, deletes only self-declared occasions declared before the
// 30-day cutoff (the same rule as the declare cooldown), oldest first, at most 1000 per run, idempotent.
type Row = { id: string; declaredAt: Date };
let rows: Row[] = [];
const findMany = vi.fn();
const deleteMany = vi.fn();
const captureError = vi.fn();

const matches = (row: Row, where: { id?: { in: string[] }; declaredAt?: { lt: Date } }) =>
  (!where.id || where.id.in.includes(row.id)) && (!where.declaredAt || row.declaredAt < where.declaredAt.lt);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    giftSelfOccasion: {
      findMany: (args: { where: { declaredAt: { lt: Date } }; take: number }) => {
        findMany(args);
        return Promise.resolve(
          rows
            .filter((row) => matches(row, args.where))
            .sort((a, b) => a.declaredAt.getTime() - b.declaredAt.getTime())
            .slice(0, args.take)
            .map((row) => ({ id: row.id })),
        );
      },
      deleteMany: (args: { where: { id: { in: string[] }; declaredAt: { lt: Date } } }) => {
        deleteMany(args);
        const before = rows.length;
        rows = rows.filter((row) => !matches(row, args.where));
        return Promise.resolve({ count: before - rows.length });
      },
    },
  },
}));
vi.mock("@/lib/error-tracking", () => ({ captureError: (...a: unknown[]) => captureError(...a) }));

import { GET } from "./route";

const DAY = 24 * 60 * 60_000;
const NOW = new Date("2026-11-13T04:41:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const request = (auth?: string) =>
  new Request("https://yukon3t.test/api/cron/prune-gift-occasions", auth ? { headers: { authorization: auth } } : {});

describe("GET /api/cron/prune-gift-occasions", () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    process.env.CRON_SECRET = "s3cret";
    rows = [];
    findMany.mockReset();
    deleteMany.mockReset();
    captureError.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("is not configured without CRON_SECRET", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(request("Bearer s3cret"))).status).toBe(503);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("refuses a missing or wrong bearer token and touches nothing", async () => {
    rows = [{ id: "old", declaredAt: ago(40 * DAY) }];
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("Bearer nope"))).status).toBe(401);
    expect(findMany).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
  });

  it("deletes only rows declared before the 30-day cutoff, never recent ones", async () => {
    rows = [
      { id: "old", declaredAt: ago(31 * DAY) },
      { id: "just-past", declaredAt: ago(SELF_OCCASION_COOLDOWN_MS + 1) },
      { id: "at-cutoff", declaredAt: ago(SELF_OCCASION_COOLDOWN_MS) },
      { id: "recent", declaredAt: ago(29 * DAY) },
      { id: "today", declaredAt: ago(60_000) },
    ];
    const res = await GET(request("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ error: null, due: 2, deleted: 2 });
    expect(rows.map((r) => r.id).sort()).toEqual(["at-cutoff", "recent", "today"]);
    // The cutoff is the same 30 days the declare cooldown uses, and the delete re-checks it.
    const cutoff = findMany.mock.calls[0][0].where.declaredAt.lt as Date;
    expect(cutoff.getTime()).toBe(NOW.getTime() - SELF_OCCASION_COOLDOWN_MS);
    expect(deleteMany.mock.calls[0][0].where.declaredAt.lt).toEqual(cutoff);
  });

  it("is bounded to 1000 rows per run, oldest first", async () => {
    rows = Array.from({ length: 1205 }, (_, i) => ({ id: `r${i}`, declaredAt: ago(31 * DAY + i * 60_000) }));
    const res = await GET(request("Bearer s3cret"));
    expect(await res.json()).toEqual({ error: null, due: 1000, deleted: 1000 });
    expect(findMany.mock.calls[0][0]).toMatchObject({ take: 1000, orderBy: { declaredAt: "asc" }, select: { id: true } });
    expect(deleteMany.mock.calls[0][0].where.id.in).toHaveLength(1000);
    // The 205 newest of the old rows are left for the next run.
    expect(rows).toHaveLength(205);
    expect(rows.every((r) => Number(r.id.slice(1)) < 205)).toBe(true);
    expect(await (await GET(request("Bearer s3cret"))).json()).toEqual({ error: null, due: 205, deleted: 205 });
    expect(rows).toHaveLength(0);
  });

  it("is idempotent: a repeat run finds nothing and deletes nothing", async () => {
    rows = [
      { id: "old", declaredAt: ago(45 * DAY) },
      { id: "recent", declaredAt: ago(2 * DAY) },
    ];
    await GET(request("Bearer s3cret"));
    deleteMany.mockReset();
    const res = await GET(request("Bearer s3cret"));
    expect(await res.json()).toEqual({ error: null, due: 0, deleted: 0 });
    expect(deleteMany).not.toHaveBeenCalled();
    expect(rows.map((r) => r.id)).toEqual(["recent"]);
  });

  it("reports a failed run as a 500 and to error tracking", async () => {
    findMany.mockImplementation(() => {
      throw new Error("boom");
    });
    const res = await GET(request("Bearer s3cret"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "failed" });
    expect(captureError).toHaveBeenCalledTimes(1);
  });
});
