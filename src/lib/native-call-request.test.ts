import { describe, expect, it } from "vitest";
import { parseNativeCallEndRequest } from "@/lib/native-call-request";

describe("parseNativeCallEndRequest", () => {
  it("reads a CallKit End as a hang-up CallKit already ended on this iPhone", () => {
    expect(parseNativeCallEndRequest("1", { action: "end", callId: "c_1", voipToken: "abc" })).toEqual({
      callId: "c_1",
      device: { platform: "ios", voipToken: "abc", callKitEnded: true },
    });
  });

  it("keeps the hang-up without a usable token (the server then just matches no device)", () => {
    expect(parseNativeCallEndRequest("1", { action: "end", callId: "c1" })?.device).toEqual({
      platform: "ios",
      voipToken: null,
      callKitEnded: true,
    });
    expect(parseNativeCallEndRequest("1", { action: "end", callId: "c1", voipToken: "x".repeat(513) })?.device).toEqual({
      platform: "ios",
      voipToken: null,
      callKitEnded: true,
    });
  });

  it("refuses a request without the native header (a cross-site form can't send it)", () => {
    expect(parseNativeCallEndRequest(null, { action: "end", callId: "c1" })).toBeNull();
    expect(parseNativeCallEndRequest("0", { action: "end", callId: "c1" })).toBeNull();
  });

  it("refuses anything but an end with a plausible call id", () => {
    expect(parseNativeCallEndRequest("1", { action: "answer", callId: "c1" })).toBeNull();
    expect(parseNativeCallEndRequest("1", { action: "end" })).toBeNull();
    expect(parseNativeCallEndRequest("1", { action: "end", callId: "" })).toBeNull();
    expect(parseNativeCallEndRequest("1", { action: "end", callId: "../x" })).toBeNull();
    expect(parseNativeCallEndRequest("1", { action: "end", callId: "c".repeat(65) })).toBeNull();
    expect(parseNativeCallEndRequest("1", null)).toBeNull();
    expect(parseNativeCallEndRequest("1", "end")).toBeNull();
  });
});
