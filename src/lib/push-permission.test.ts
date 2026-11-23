import { describe, expect, it } from "vitest";
import {
  PUSH_ASK_MAX,
  PUSH_ASK_SNOOZE_MS,
  blockedPushHelp,
  nativePushPermission,
  nextPushAskRecord,
  parsePushAskRecord,
  pushAskStorageKey,
  shouldOfferPushPrompt,
  webPushPermission,
} from "@/lib/push-permission";
import { ALERT_NOTIFICATION_CHANNEL_ID, ALERT_NOTIFICATION_CHANNEL_IMPORTANCE, alertAndroidConfig, alertApnsConfig } from "@/lib/alert-push";
import { QUIET_NOTIFICATION_CHANNEL_ID } from "@/lib/quiet-push";

describe("nativePushPermission", () => {
  it("maps the plugin's states", () => {
    expect(nativePushPermission("granted")).toBe("granted");
    expect(nativePushPermission("denied")).toBe("denied");
    expect(nativePushPermission("prompt")).toBe("prompt");
    // Android after one refusal: the system prompt can still be shown.
    expect(nativePushPermission("prompt-with-rationale")).toBe("prompt");
    expect(nativePushPermission(undefined)).toBe("unsupported");
    expect(nativePushPermission("weird")).toBe("unsupported");
  });
});

describe("webPushPermission", () => {
  const full = { vapidKey: true, serviceWorker: true, pushManager: true };
  it("needs the VAPID key, a service worker, the Push API and the Notification API", () => {
    expect(webPushPermission({ ...full, notificationPermission: "default" })).toBe("prompt");
    expect(webPushPermission({ ...full, vapidKey: false, notificationPermission: "default" })).toBe("unsupported");
    expect(webPushPermission({ ...full, serviceWorker: false, notificationPermission: "default" })).toBe("unsupported");
    // iPhone Safari outside a Home Screen web app: no PushManager.
    expect(webPushPermission({ ...full, pushManager: false, notificationPermission: "default" })).toBe("unsupported");
    expect(webPushPermission({ ...full, notificationPermission: null })).toBe("unsupported");
  });
  it("maps the browser's permission", () => {
    expect(webPushPermission({ ...full, notificationPermission: "granted" })).toBe("granted");
    expect(webPushPermission({ ...full, notificationPermission: "denied" })).toBe("denied");
  });
});

describe("ask record", () => {
  it("is per account", () => {
    expect(pushAskStorageKey("u1")).not.toBe(pushAskStorageKey("u2"));
  });
  it("parses only well-formed records", () => {
    expect(parsePushAskRecord(JSON.stringify({ asks: 2, lastAskedAt: 5 }))).toEqual({ asks: 2, lastAskedAt: 5 });
    expect(parsePushAskRecord(null)).toBeNull();
    expect(parsePushAskRecord("")).toBeNull();
    expect(parsePushAskRecord("{")).toBeNull();
    expect(parsePushAskRecord("null")).toBeNull();
    expect(parsePushAskRecord(JSON.stringify({ asks: -1, lastAskedAt: 5 }))).toBeNull();
    expect(parsePushAskRecord(JSON.stringify({ asks: 1.5, lastAskedAt: 5 }))).toBeNull();
    expect(parsePushAskRecord(JSON.stringify({ asks: 1, lastAskedAt: "x" }))).toBeNull();
  });
  it("counts showings", () => {
    expect(nextPushAskRecord(null, 10)).toEqual({ asks: 1, lastAskedAt: 10 });
    expect(nextPushAskRecord({ asks: 1, lastAskedAt: 10 }, 20)).toEqual({ asks: 2, lastAskedAt: 20 });
  });
});

describe("shouldOfferPushPrompt", () => {
  const now = 1_000_000_000_000;
  const base = { permission: "prompt" as const, pathname: "/home", record: null, now };

  it("asks on Home the first time while the system prompt can still be shown", () => {
    expect(shouldOfferPushPrompt(base)).toBe(true);
  });
  it("never asks once decided or where notifications can't work", () => {
    for (const permission of ["granted", "denied", "unsupported"] as const) {
      expect(shouldOfferPushPrompt({ ...base, permission })).toBe(false);
    }
  });
  it("only on Home", () => {
    expect(shouldOfferPushPrompt({ ...base, pathname: "/messages" })).toBe(false);
    expect(shouldOfferPushPrompt({ ...base, pathname: "/home/x" })).toBe(false);
  });
  it("waits out the snooze after Not now, and stops after the last ask", () => {
    const record = { asks: 1, lastAskedAt: now - PUSH_ASK_SNOOZE_MS + 1 };
    expect(shouldOfferPushPrompt({ ...base, record })).toBe(false);
    expect(shouldOfferPushPrompt({ ...base, record: { ...record, lastAskedAt: now - PUSH_ASK_SNOOZE_MS } })).toBe(true);
    expect(shouldOfferPushPrompt({ ...base, record: { asks: PUSH_ASK_MAX, lastAskedAt: 0 } })).toBe(false);
  });
  it("never opens over another sheet or dialog", () => {
    expect(shouldOfferPushPrompt({ ...base, otherModalOpen: true })).toBe(false);
    expect(shouldOfferPushPrompt({ ...base, otherModalOpen: false })).toBe(true);
  });
  it("treats a clock that went backwards as too recent", () => {
    expect(shouldOfferPushPrompt({ ...base, record: { asks: 1, lastAskedAt: now + 1000 } })).toBe(false);
  });
});

describe("blockedPushHelp", () => {
  it("opens Settings on iPhone, explains the steps on Android", () => {
    expect(blockedPushHelp("ios")).toBe("open-settings");
    expect(blockedPushHelp("android")).toBe("instructions");
  });
});

describe("alert notifications (alert-push.ts)", () => {
  it("post to a heads-up channel of their own, never the quiet one", () => {
    expect(ALERT_NOTIFICATION_CHANNEL_IMPORTANCE).toBe(4);
    expect(ALERT_NOTIFICATION_CHANNEL_ID).not.toBe(QUIET_NOTIFICATION_CHANNEL_ID);
    expect(alertAndroidConfig()).toEqual({
      priority: "high",
      notification: {
        channelId: ALERT_NOTIFICATION_CHANNEL_ID,
        priority: "high",
        defaultSound: true,
        defaultVibrateTimings: true,
      },
    });
  });
  it("play the default sound on iPhone, delivered at once", () => {
    expect(alertApnsConfig()).toEqual({ headers: { "apns-priority": "10" }, payload: { aps: { sound: "default" } } });
  });
});
