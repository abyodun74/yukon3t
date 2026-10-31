import { describe, expect, it } from "vitest";
import {
  type CircleMemberCursor,
  appendCircleMemberPage,
  CIRCLE_MEMBERS_PAGE_SIZE,
  circleMemberPageWhere,
  splitCircleMemberPage,
} from "./circle-members";

const row = (n: number) => ({
  membershipId: `cm${String(n).padStart(10, "0")}`,
  joinedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
  user: { id: `u${n}` },
});

describe("circleMemberPageWhere", () => {
  it("is the whole Circle without a cursor", () => {
    expect(circleMemberPageWhere("c1", null)).toEqual({ circleId: "c1" });
  });

  it("continues strictly after the cursor in (joinedAt, id) order", () => {
    const at = "2026-01-01T00:00:05.000Z";
    expect(circleMemberPageWhere("c1", { joinedAt: at, id: "cm5" })).toEqual({
      circleId: "c1",
      OR: [{ joinedAt: { gt: new Date(at) } }, { joinedAt: new Date(at), id: { gt: "cm5" } }],
    });
  });
});

describe("splitCircleMemberPage", () => {
  it("pages of 50 by default", () => {
    expect(CIRCLE_MEMBERS_PAGE_SIZE).toBe(50);
  });

  it("has no next page when the extra row is missing", () => {
    const rows = [row(1), row(2), row(3)];
    expect(splitCircleMemberPage(rows, 3)).toEqual({ members: rows, nextCursor: null });
    expect(splitCircleMemberPage([], 3)).toEqual({ members: [], nextCursor: null });
  });

  it("drops the look-ahead row and points the cursor at the last row shown", () => {
    const rows = [row(1), row(2), row(3), row(4)];
    const page = splitCircleMemberPage(rows, 3);
    expect(page.members).toEqual(rows.slice(0, 3));
    expect(page.nextCursor).toEqual({ joinedAt: row(3).joinedAt, id: row(3).membershipId });
  });

  it("walks a whole Circle without skipping or repeating anyone", () => {
    const all = Array.from({ length: 11 }, (_, i) => row(i + 1));
    const seen: string[] = [];
    let cursor: CircleMemberCursor | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const after: CircleMemberCursor | null = cursor;
      const rest: ReturnType<typeof row>[] = after
        ? all.filter((r) => r.joinedAt > after.joinedAt || (r.joinedAt === after.joinedAt && r.membershipId > after.id))
        : all;
      const page: { members: ReturnType<typeof row>[]; nextCursor: CircleMemberCursor | null } =
        splitCircleMemberPage(rest.slice(0, 5), 4);
      seen.push(...page.members.map((m) => m.user.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(all.map((r) => r.user.id));
  });
});

describe("appendCircleMemberPage", () => {
  it("appends without listing anyone twice", () => {
    expect(appendCircleMemberPage([row(1), row(2)], [row(2), row(3)]).map((m) => m.user.id)).toEqual(["u1", "u2", "u3"]);
  });
});
