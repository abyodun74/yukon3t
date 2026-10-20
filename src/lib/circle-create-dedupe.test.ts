import { describe, it, expect } from "vitest";
import {
  CIRCLE_CREATE_DEDUPE_WINDOW_MS,
  circleCreateLockKey,
  circleDedupeCutoff,
  isRecentDuplicateCircle,
  normalizeCircleName,
} from "@/lib/circle-create-dedupe";

const now = new Date("2026-10-20T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const input = { userId: "u1", name: "Book Club", parentId: null };
const existing = { createdById: "u1", name: "book club ", parentId: null, createdAt: ago(5000) };

describe("circle create dedupe", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeCircleName("  Book CLUB ")).toBe("book club");
  });
  it("builds a stable lock key", () => {
    expect(circleCreateLockKey("u1", " Book Club", null)).toBe("u1:book club:");
    expect(circleCreateLockKey("u1", "x", "p1")).toBe("u1:x:p1");
  });
  it("computes the cutoff", () => {
    expect(now.getTime() - circleDedupeCutoff(now).getTime()).toBe(CIRCLE_CREATE_DEDUPE_WINDOW_MS);
  });
  it("flags a recent same-name duplicate", () => {
    expect(isRecentDuplicateCircle(existing, input, now)).toBe(true);
  });
  it("accepts the boundary and rejects older", () => {
    expect(isRecentDuplicateCircle({ ...existing, createdAt: ago(CIRCLE_CREATE_DEDUPE_WINDOW_MS) }, input, now)).toBe(true);
    expect(isRecentDuplicateCircle({ ...existing, createdAt: ago(CIRCLE_CREATE_DEDUPE_WINDOW_MS + 1) }, input, now)).toBe(false);
  });
  it("rejects different creator, name or parent", () => {
    expect(isRecentDuplicateCircle({ ...existing, createdById: "u2" }, input, now)).toBe(false);
    expect(isRecentDuplicateCircle({ ...existing, name: "Other" }, input, now)).toBe(false);
    expect(isRecentDuplicateCircle({ ...existing, parentId: "p1" }, input, now)).toBe(false);
    expect(isRecentDuplicateCircle(existing, { ...input, parentId: "p1" }, now)).toBe(false);
  });
});
