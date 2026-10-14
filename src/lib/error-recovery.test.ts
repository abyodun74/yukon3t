import { describe, it, expect } from "vitest";
import { ERROR_RECOVERY_WINDOW_MS, nextRecoveryAction, parseRecoveryRecord } from "@/lib/error-recovery";

const base = { path: "/home", now: 1_000_000, online: true, reloadSafe: true };

describe("nextRecoveryAction", () => {
  it("retries in place on the first crash", () => {
    expect(nextRecoveryAction({ ...base, last: null })).toBe("retry");
  });

  it("reloads once when the retry crashed again straight away", () => {
    expect(nextRecoveryAction({ ...base, last: { path: "/home", step: "retry", at: base.now - 1_000 } })).toBe("reload");
  });

  it("shows the screen when the reload didn't help either", () => {
    expect(nextRecoveryAction({ ...base, last: { path: "/home", step: "reload", at: base.now - 1_000 } })).toBe("show");
  });

  it("skips the reload while one isn't safe", () => {
    expect(
      nextRecoveryAction({ ...base, reloadSafe: false, last: { path: "/home", step: "retry", at: base.now - 1_000 } }),
    ).toBe("show");
  });

  it("starts over once the window has passed", () => {
    const at = base.now - ERROR_RECOVERY_WINDOW_MS;
    expect(nextRecoveryAction({ ...base, last: { path: "/home", step: "reload", at } })).toBe("retry");
  });

  it("keeps each path's attempts apart", () => {
    expect(nextRecoveryAction({ ...base, last: { path: "/messages", step: "reload", at: base.now - 1_000 } })).toBe(
      "retry",
    );
  });

  it("never acts while offline", () => {
    expect(nextRecoveryAction({ ...base, online: false, last: null })).toBe("show");
  });

  it("treats a record from the future (clock change) as stale", () => {
    expect(nextRecoveryAction({ ...base, last: { path: "/home", step: "reload", at: base.now + 5_000 } })).toBe("retry");
  });
});

describe("parseRecoveryRecord", () => {
  it("reads a well-formed record", () => {
    expect(parseRecoveryRecord(JSON.stringify({ path: "/home", step: "retry", at: 5 }))).toEqual({
      path: "/home",
      step: "retry",
      at: 5,
    });
  });

  it("rejects anything else", () => {
    expect(parseRecoveryRecord(null)).toBeNull();
    expect(parseRecoveryRecord("not json")).toBeNull();
    expect(parseRecoveryRecord(JSON.stringify({ path: "/home", step: "other", at: 5 }))).toBeNull();
    expect(parseRecoveryRecord(JSON.stringify({ path: 1, step: "retry", at: 5 }))).toBeNull();
  });
});
