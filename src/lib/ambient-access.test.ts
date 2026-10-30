import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// Audit M4 (2026-10-29): the ambient feed (in-app preview and the widget route) re-checks inner-circle membership on
// every read, blocks remove inner-circle rows both ways, and the widget token dies with a non-ACTIVE owner, a password
// reset/change and a ban/suspension.

const OWNER = "cowner00000001";
const innerFindMany = vi.fn();
const connFindMany = vi.fn();
const blockFindMany = vi.fn();

vi.mock("@/lib/hidden-chats", () => ({ getHiddenPeerIds: async () => ["chidden0000001"] }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    innerCircleMember: { findMany: (a: unknown) => innerFindMany(a) },
    connection: { findMany: (a: unknown) => connFindMany(a) },
    block: { findMany: (a: unknown) => blockFindMany(a) },
  },
}));

const { currentInnerCircleMemberIds, innerCircleRowsBetween, activeWidgetTokensOf } = await import("@/lib/ambient-access");

beforeEach(() => vi.clearAllMocks());

describe("currentInnerCircleMemberIds", () => {
  it("keeps only members still connected and not blocked either way", async () => {
    innerFindMany.mockResolvedValue([{ memberId: "ca" }, { memberId: "cb" }, { memberId: "cc" }, { memberId: "cd" }]);
    connFindMany.mockResolvedValue([
      { requesterId: OWNER, targetId: "ca" },
      { requesterId: "cb", targetId: OWNER },
      { requesterId: OWNER, targetId: "cd" },
    ]);
    // cc: no connection any more; cd: blocked the owner.
    blockFindMany.mockResolvedValue([{ blockerId: "cd", blockedId: OWNER }]);
    expect(await currentInnerCircleMemberIds(OWNER)).toEqual(["ca", "cb"]);
  });

  it("asks only for ACTIVE members outside the owner's hidden chats", async () => {
    innerFindMany.mockResolvedValue([]);
    expect(await currentInnerCircleMemberIds(OWNER)).toEqual([]);
    expect(innerFindMany).toHaveBeenCalledWith({
      where: { ownerId: OWNER, memberId: { notIn: ["chidden0000001"] }, member: { status: "ACTIVE" } },
      select: { memberId: true },
    });
    expect(connFindMany).not.toHaveBeenCalled();
  });

  it("helpers cover both directions / only active tokens", () => {
    expect(innerCircleRowsBetween("cx", "cy")).toEqual({
      OR: [
        { ownerId: "cx", memberId: "cy" },
        { ownerId: "cy", memberId: "cx" },
      ],
    });
    expect(activeWidgetTokensOf("cx").where).toEqual({ userId: "cx", revokedAt: null });
  });
});

describe("wiring (source scan)", () => {
  const read = (f: string) => readFileSync(f, "utf8");
  it("both feed readers use the re-checked member list", () => {
    expect(read("src/app/actions/ambient.ts")).toContain("currentInnerCircleMemberIds(user.id)");
    expect(read("src/app/api/ambient/feed/route.ts")).toContain("currentInnerCircleMemberIds(widgetToken.userId)");
  });
  it("the widget route refuses a non-ACTIVE owner", () => {
    expect(read("src/app/api/ambient/feed/route.ts")).toContain('widgetToken.user.status !== "ACTIVE"');
  });
  it("blocking removes inner-circle rows both ways", () => {
    expect(read("src/app/actions/blocks.ts")).toContain("innerCircleMember.deleteMany({ where: innerCircleRowsBetween(user.id, targetId) })");
  });
  it("password reset/change and ban/suspension revoke widget tokens", () => {
    expect(read("src/app/actions/password-auth.ts")).toContain("activeWidgetTokensOf(resetToken.userId)");
    expect(read("src/app/actions/profile.ts").match(/activeWidgetTokensOf\(user\.id\)/g)?.length).toBe(2);
    expect(read("src/app/actions/reports.ts")).toContain("activeWidgetTokensOf(report.reportedUserId)");
  });
});
