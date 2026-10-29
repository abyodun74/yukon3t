import { describe, expect, it } from "vitest";
import { SILENT_CALL_APNS, incomingCallData, missedCallApns, missedCallData } from "@/lib/call-push-data";

describe("incomingCallData", () => {
  it("carries the caller's picture link when there is one", () => {
    expect(
      incomingCallData({
        callId: "c1",
        callerName: "Ada",
        callType: "VIDEO",
        callerAvatarUrl: "https://acct.r2.cloudflarestorage.com/avatars/avatar/u1/x-t.jpg?X-Amz-Signature=abc",
      }),
    ).toEqual({
      type: "incoming_call",
      callId: "c1",
      callerName: "Ada",
      callType: "VIDEO",
      callerAvatarUrl: "https://acct.r2.cloudflarestorage.com/avatars/avatar/u1/x-t.jpg?X-Amz-Signature=abc",
    });
  });

  it("leaves the field out entirely (not empty) when there is no picture, e.g. a Private call", () => {
    for (const callerAvatarUrl of [null, undefined, ""]) {
      const data = incomingCallData({ callId: "c1", callerName: "Private call", callType: "AUDIO", callerAvatarUrl });
      expect(data).toEqual({ type: "incoming_call", callId: "c1", callerName: "Private call", callType: "AUDIO" });
      expect("callerAvatarUrl" in data).toBe(false);
    }
  });

  it("only ever has string values (an FCM data message requirement)", () => {
    const data = incomingCallData({ callId: "c1", callerName: "Ada", callType: "AUDIO", callerAvatarUrl: "https://x/y" });
    expect(Object.values(data).every((v) => typeof v === "string")).toBe(true);
  });
});

describe("missedCallData", () => {
  it("carries the in-app path a tap opens", () => {
    expect(missedCallData({ callId: "c1", callerName: "Ada", url: "/u/caller" })).toEqual({
      type: "missed_call",
      callId: "c1",
      callerName: "Ada",
      url: "/u/caller",
    });
  });
});

describe("missedCallApns", () => {
  const apns = missedCallApns({ callerId: "cmabc123def456ghi789jkl01", title: "Missed call", body: "Ada called you" });

  it("is a visible, immediate alert push (not a silent background one)", () => {
    expect(apns.headers?.["apns-push-type"]).toBe("alert");
    expect(apns.headers?.["apns-priority"]).toBe("10");
    expect(apns.payload?.aps.alert).toEqual({ title: "Missed call", body: "Ada called you" });
    expect(apns.payload?.aps.contentAvailable).toBeUndefined();
  });

  it("collapses and groups repeated missed calls per caller", () => {
    const key = "missed-call-cmabc123def456ghi789jkl01";
    expect(apns.headers?.["apns-collapse-id"]).toBe(key);
    expect(apns.payload?.aps.threadId).toBe(key);
    // APNs rejects a collapse id over 64 bytes.
    expect(new TextEncoder().encode(key).length).toBeLessThanOrEqual(64);
    const other = missedCallApns({ callerId: "someoneelse", title: "t", body: "b" });
    expect(other.headers?.["apns-collapse-id"]).not.toBe(key);
  });

  it("carries no sound, picture or badge", () => {
    expect(Object.keys(apns.payload?.aps ?? {}).sort()).toEqual(["alert", "threadId"]);
    expect(apns.fcmOptions).toBeUndefined();
  });
});

describe("SILENT_CALL_APNS", () => {
  it("stays a silent background push for incoming_call / call_cancelled", () => {
    expect(SILENT_CALL_APNS).toEqual({
      headers: { "apns-priority": "5", "apns-push-type": "background" },
      payload: { aps: { contentAvailable: true } },
    });
  });
});
