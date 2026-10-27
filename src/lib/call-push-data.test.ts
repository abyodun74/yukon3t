import { describe, expect, it } from "vitest";
import { incomingCallData, missedCallData } from "@/lib/call-push-data";

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
