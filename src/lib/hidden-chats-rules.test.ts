import { describe, expect, it } from "vitest";
import {
  HIDDEN_PIN_ATTEMPTS_PER_LOCK,
  HIDDEN_PIN_BASE_LOCK_MS,
  HIDDEN_PIN_MAX_LOCK_MS,
  HIDDEN_PIN_PATTERN,
  HIDDEN_PUSH_TYPE,
  hiddenPinAttemptsLeft,
  hiddenPinLockoutUntil,
  hiddenPushPayload,
  hiddenUnlockPath,
  isHiddenNotification,
  isHiddenPinLocked,
  safeHiddenNext,
  splitHiddenRecipients,
  visibleNotificationWhere,
} from "@/lib/hidden-chats-rules";
import {
  changeHiddenPinSchema,
  hiddenPinSchema,
  resetHiddenPinSchema,
  setHiddenPinSchema,
} from "@/lib/validations";

const NOW = new Date("2026-10-11T12:00:00Z");
const minutesFromNow = (date: Date | null) => (date ? (date.getTime() - NOW.getTime()) / 60_000 : null);

describe("PIN format", () => {
  it("accepts 4 to 8 digits and nothing else", () => {
    for (const pin of ["1234", "00000", "12345678"]) expect(HIDDEN_PIN_PATTERN.test(pin)).toBe(true);
    for (const pin of ["", "123", "123456789", "12a4", " 1234", "1234 ", "١٢٣٤"]) {
      expect(HIDDEN_PIN_PATTERN.test(pin)).toBe(false);
    }
    expect(hiddenPinSchema.safeParse("4821").success).toBe(true);
    expect(hiddenPinSchema.safeParse("48 21").success).toBe(false);
  });

  it("requires the new PIN to be entered the same twice", () => {
    expect(setHiddenPinSchema.safeParse({ newPin: "4821", confirmPin: "4821" }).success).toBe(true);
    expect(setHiddenPinSchema.safeParse({ newPin: "4821", confirmPin: "4822" }).success).toBe(false);
    expect(setHiddenPinSchema.safeParse({ newPin: "48", confirmPin: "48" }).success).toBe(false);
    expect(changeHiddenPinSchema.safeParse({ currentPin: "1111", newPin: "2222", confirmPin: "2222" }).success).toBe(true);
    expect(changeHiddenPinSchema.safeParse({ currentPin: "1111", newPin: "2222", confirmPin: "3333" }).success).toBe(false);
    expect(resetHiddenPinSchema.safeParse({ accountPassword: "", newPin: "2222", confirmPin: "2222" }).success).toBe(false);
  });
});

describe("hiddenPinLockoutUntil", () => {
  it("doesn't lock on the first four wrong attempts", () => {
    for (let attempts = 0; attempts < HIDDEN_PIN_ATTEMPTS_PER_LOCK; attempts++) {
      expect(hiddenPinLockoutUntil(attempts, NOW)).toBeNull();
    }
  });

  it("locks for 15 minutes on the fifth", () => {
    expect(minutesFromNow(hiddenPinLockoutUntil(5, NOW))).toBe(15);
    expect(HIDDEN_PIN_BASE_LOCK_MS).toBe(15 * 60 * 1000);
  });

  it("only locks on every fifth attempt in between", () => {
    for (const attempts of [6, 7, 8, 9, 11, 14]) expect(hiddenPinLockoutUntil(attempts, NOW)).toBeNull();
  });

  it("doubles each time the count reaches another multiple of five", () => {
    expect(minutesFromNow(hiddenPinLockoutUntil(10, NOW))).toBe(30);
    expect(minutesFromNow(hiddenPinLockoutUntil(15, NOW))).toBe(60);
    expect(minutesFromNow(hiddenPinLockoutUntil(20, NOW))).toBe(120);
    expect(minutesFromNow(hiddenPinLockoutUntil(35, NOW))).toBe(960);
  });

  it("never locks for more than a day, however high the count", () => {
    expect(minutesFromNow(hiddenPinLockoutUntil(40, NOW))).toBe(24 * 60);
    expect(minutesFromNow(hiddenPinLockoutUntil(5_000_000, NOW))).toBe(HIDDEN_PIN_MAX_LOCK_MS / 60_000);
  });

  it("ignores a nonsensical count", () => {
    expect(hiddenPinLockoutUntil(-5, NOW)).toBeNull();
  });
});

describe("isHiddenPinLocked / hiddenPinAttemptsLeft", () => {
  it("is locked only until the stored time", () => {
    expect(isHiddenPinLocked(null, NOW)).toBe(false);
    expect(isHiddenPinLocked(new Date(NOW.getTime() + 1), NOW)).toBe(true);
    expect(isHiddenPinLocked(NOW, NOW)).toBe(false);
    expect(isHiddenPinLocked(new Date(NOW.getTime() - 1), NOW)).toBe(false);
  });

  it("counts down to the next lock", () => {
    expect(hiddenPinAttemptsLeft(1)).toBe(4);
    expect(hiddenPinAttemptsLeft(4)).toBe(1);
    expect(hiddenPinAttemptsLeft(6)).toBe(4);
    expect(hiddenPinAttemptsLeft(9)).toBe(1);
  });
});

describe("hiddenPushPayload", () => {
  it("is the fixed generic notification that opens Home", () => {
    expect(hiddenPushPayload()).toEqual({
      title: "YuKon3t",
      body: "You have a new notification",
      url: "/home",
    });
  });

  it("carries nothing else, and isn't typed as a message for the native side", () => {
    expect(Object.keys(hiddenPushPayload()).sort()).toEqual(["body", "title", "url"]);
    expect(JSON.stringify(hiddenPushPayload())).not.toMatch(/messages/i);
    expect(HIDDEN_PUSH_TYPE).not.toBe("MESSAGE");
  });
});

describe("splitHiddenRecipients", () => {
  it("separates recipients hiding the chat from the rest, keeping order", () => {
    expect(splitHiddenRecipients(["a", "b", "c", "d"], ["c", "a"])).toEqual({ open: ["b", "d"], hidden: ["a", "c"] });
  });

  it("puts everyone in open when nobody hides it", () => {
    expect(splitHiddenRecipients(["a", "b"], [])).toEqual({ open: ["a", "b"], hidden: [] });
  });

  it("puts everyone in hidden when all do (also the fail-closed case)", () => {
    expect(splitHiddenRecipients(["a", "b"], ["a", "b"])).toEqual({ open: [], hidden: ["a", "b"] });
  });

  it("ignores hiding ids that aren't recipients, and never lists anyone twice", () => {
    const { open, hidden } = splitHiddenRecipients(["a", "b"], new Set(["b", "zzz"]));
    expect(open).toEqual(["a"]);
    expect(hidden).toEqual(["b"]);
  });
});

describe("isHiddenNotification", () => {
  const hidden = { conversationIds: ["conv-hidden"], peerIds: ["peer-hidden"] };
  const row = (type: string, actorId: string, conversationId: string | null) => ({ type, actorId, conversationId });

  it("hides any row tied to a hidden conversation, whoever the actor is", () => {
    expect(isHiddenNotification(row("MESSAGE", "someone", "conv-hidden"), hidden)).toBe(true);
    expect(isHiddenNotification(row("GROUP_ADDED", "someone", "conv-hidden"), hidden)).toBe(true);
    expect(isHiddenNotification(row("SCREENSHOT_TAKEN", "someone", "conv-hidden"), hidden)).toBe(true);
  });

  it("hides a hidden peer's private rows even without a conversation id", () => {
    expect(isHiddenNotification(row("MISSED_CALL", "peer-hidden", null), hidden)).toBe(true);
    expect(isHiddenNotification(row("SCREENSHOT_TAKEN", "peer-hidden", null), hidden)).toBe(true);
  });

  it("leaves a hidden peer's public activity alone", () => {
    expect(isHiddenNotification(row("POST_LIKE", "peer-hidden", null), hidden)).toBe(false);
    expect(isHiddenNotification(row("POST_COMMENT", "peer-hidden", null), hidden)).toBe(false);
  });

  it("leaves everyone else's rows alone", () => {
    expect(isHiddenNotification(row("MESSAGE", "friend", "conv-open"), hidden)).toBe(false);
    expect(isHiddenNotification(row("MISSED_CALL", "friend", null), hidden)).toBe(false);
  });

  it("hides nothing for someone with nothing hidden", () => {
    expect(isHiddenNotification(row("MESSAGE", "x", "c"), { conversationIds: [], peerIds: [] })).toBe(false);
  });
});

describe("visibleNotificationWhere", () => {
  it("adds no condition when nothing is hidden", () => {
    expect(visibleNotificationWhere({ conversationIds: [], peerIds: [] })).toEqual([]);
  });

  it("keeps rows with no conversation at all", () => {
    expect(visibleNotificationWhere({ conversationIds: ["c1"], peerIds: [] })).toEqual([
      { OR: [{ conversationId: null }, { conversationId: { notIn: ["c1"] } }] },
    ]);
  });

  it("excludes only the private types for a hidden peer", () => {
    expect(visibleNotificationWhere({ conversationIds: [], peerIds: ["p1"] })).toEqual([
      { OR: [{ actorId: { notIn: ["p1"] } }, { type: { notIn: ["MESSAGE", "MISSED_CALL", "SCREENSHOT_TAKEN"] } }] },
    ]);
  });
});

describe("unlock routes", () => {
  it("only ever returns the user to a conversation thread", () => {
    expect(safeHiddenNext("/messages/cmabc123def")).toBe("/messages/cmabc123def");
    expect(safeHiddenNext("/messages/hidden")).toBeNull();
    expect(safeHiddenNext("https://evil.example/messages/abc")).toBeNull();
    expect(safeHiddenNext("//evil.example")).toBeNull();
    expect(safeHiddenNext("/messages/abc/../../settings")).toBeNull();
    expect(safeHiddenNext("/settings")).toBeNull();
    expect(safeHiddenNext(undefined)).toBeNull();
  });

  it("round-trips a conversation through the unlock path", () => {
    const path = hiddenUnlockPath("cmabc123def");
    expect(path.startsWith("/messages/hidden?next=")).toBe(true);
    expect(safeHiddenNext(new URLSearchParams(path.split("?")[1]).get("next"))).toBe("/messages/cmabc123def");
    expect(hiddenUnlockPath()).toBe("/messages/hidden");
  });
});
