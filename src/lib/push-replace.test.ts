import { describe, expect, it } from "vitest";
import { PUSH_REPLACE_KEY_MAX_BYTES, replaceableFcmConfig, safeReplaceKey } from "@/lib/push-replace";
import { liveInvitePushKey } from "@/lib/live-stage";
import { QUIET_NOTIFICATION_CHANNEL_ID } from "@/lib/quiet-push";

describe("safeReplaceKey", () => {
  it("accepts short printable ASCII keys only", () => {
    expect(safeReplaceKey("live-invite:abc")).toBe("live-invite:abc");
    expect(safeReplaceKey("")).toBeNull();
    expect(safeReplaceKey("a b")).toBeNull();
    expect(safeReplaceKey("é")).toBeNull();
    expect(safeReplaceKey(42)).toBeNull();
    expect(safeReplaceKey("x".repeat(PUSH_REPLACE_KEY_MAX_BYTES))).not.toBeNull();
    expect(safeReplaceKey("x".repeat(PUSH_REPLACE_KEY_MAX_BYTES + 1))).toBeNull();
  });

  it("fits a live invite's key for a cuid stream id", () => {
    expect(safeReplaceKey(liveInvitePushKey("cmh0abcdefghijklmnopqrstu"))).toBe("live-invite:cmh0abcdefghijklmnopqrstu");
  });
});

describe("replaceableFcmConfig", () => {
  it("sets the Android drawer tag and the APNs collapse id to the same key", () => {
    const config = replaceableFcmConfig("live-invite:s1");
    expect(config.android).toEqual({ priority: "high", notification: { tag: "live-invite:s1" } });
    expect(config.apns).toEqual({ headers: { "apns-collapse-id": "live-invite:s1" } });
  });

  it("a quiet replacement keeps the key and adds the quiet channel and passive interruption level", () => {
    const config = replaceableFcmConfig("live-invite:s1", { quiet: true });
    expect(config.android.notification).toMatchObject({
      tag: "live-invite:s1",
      channelId: QUIET_NOTIFICATION_CHANNEL_ID,
      defaultSound: false,
    });
    expect(config.apns).toEqual({
      headers: { "apns-collapse-id": "live-invite:s1" },
      payload: { aps: { "interruption-level": "passive" } },
    });
  });

  it("refuses a key no platform would accept", () => {
    expect(() => replaceableFcmConfig("bad key")).toThrow();
  });
});
