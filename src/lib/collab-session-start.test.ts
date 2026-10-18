import { describe, it, expect } from "vitest";
import {
  COLLAB_SESSION_NOTIFY_COOLDOWN_MS,
  canStartCollabSession,
  hasStartInvites,
  parseStartSessionOptions,
  sessionStartedRecipients,
  shouldNotifySessionStarted,
} from "@/lib/collab-session-start";

const cuid = (n: number) => `c${String(n).padStart(24, "0")}`;

describe("canStartCollabSession", () => {
  it("is the organizer and co-admins only", () => {
    expect(canStartCollabSession("OWNER")).toBe(true);
    expect(canStartCollabSession("MODERATOR")).toBe(true);
    expect(canStartCollabSession("PARTICIPANT")).toBe(false);
  });
});

describe("parseStartSessionOptions", () => {
  it("accepts the sheet's defaults (notify on, no pickers)", () => {
    expect(parseStartSessionOptions({ notify: true, userIds: [], circleIds: [] })).toEqual({
      notify: true,
      userIds: [],
      circleIds: [],
    });
  });

  it("drops duplicate ids", () => {
    const parsed = parseStartSessionOptions({ notify: false, userIds: [cuid(1), cuid(1)], circleIds: [cuid(2), cuid(2)] });
    expect(parsed).toEqual({ notify: false, userIds: [cuid(1)], circleIds: [cuid(2)] });
  });

  it("refuses more than five Circles, more than 50 people, non-cuid ids and missing fields", () => {
    expect(parseStartSessionOptions({ notify: true, userIds: [], circleIds: [1, 2, 3, 4, 5, 6].map(cuid) })).toBeNull();
    expect(
      parseStartSessionOptions({ notify: true, userIds: Array.from({ length: 51 }, (_, i) => cuid(i)), circleIds: [] }),
    ).toBeNull();
    expect(parseStartSessionOptions({ notify: true, userIds: ["not a cuid"], circleIds: [] })).toBeNull();
    expect(parseStartSessionOptions({ userIds: [], circleIds: [] })).toBeNull();
    expect(parseStartSessionOptions({ notify: "yes", userIds: [], circleIds: [] })).toBeNull();
    expect(parseStartSessionOptions(null)).toBeNull();
  });
});

describe("hasStartInvites", () => {
  it("is true only when someone or some Circle was picked", () => {
    expect(hasStartInvites({ notify: true, userIds: [], circleIds: [] })).toBe(false);
    expect(hasStartInvites({ notify: true, userIds: [cuid(1)], circleIds: [] })).toBe(true);
    expect(hasStartInvites({ notify: true, userIds: [], circleIds: [cuid(1)] })).toBe(true);
  });
});

describe("shouldNotifySessionStarted", () => {
  const now = new Date("2026-10-17T12:00:00Z");

  it("never notifies when the toggle is off", () => {
    expect(shouldNotifySessionStarted({ notifyRequested: false, lastSentAt: null, now })).toBe(false);
  });

  it("notifies when nothing was sent for this collab yet", () => {
    expect(shouldNotifySessionStarted({ notifyRequested: true, lastSentAt: null, now })).toBe(true);
  });

  it("stays quiet inside the 30-minute window and notifies again once it has passed", () => {
    const within = new Date(now.getTime() - COLLAB_SESSION_NOTIFY_COOLDOWN_MS + 1);
    const exactly = new Date(now.getTime() - COLLAB_SESSION_NOTIFY_COOLDOWN_MS);
    expect(COLLAB_SESSION_NOTIFY_COOLDOWN_MS).toBe(30 * 60 * 1000);
    expect(shouldNotifySessionStarted({ notifyRequested: true, lastSentAt: within, now })).toBe(false);
    expect(shouldNotifySessionStarted({ notifyRequested: true, lastSentAt: exactly, now })).toBe(true);
  });
});

describe("sessionStartedRecipients", () => {
  it("is every participant but the starter, once each", () => {
    expect(sessionStartedRecipients(["owner", "a", "b", "a"], "owner")).toEqual(["a", "b"]);
    expect(sessionStartedRecipients(["a", "owner"], "a")).toEqual(["owner"]);
    expect(sessionStartedRecipients(["owner"], "owner")).toEqual([]);
  });
});
