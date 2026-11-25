import { describe, expect, it } from "vitest";
import {
  HEART_BEAT_PEAK_GAIN,
  heartbeatDurationMs,
  planHeartbeat,
  shouldPlayHeartbeat,
  type HeartbeatGate,
} from "./heart-beat";

describe("planHeartbeat", () => {
  const [lub, dub] = planHeartbeat();

  it("is a lub then a softer dub about 120ms later", () => {
    expect(planHeartbeat()).toHaveLength(2);
    expect(lub.atMs).toBe(0);
    expect(dub.atMs - lub.atMs).toBeGreaterThanOrEqual(100);
    expect(dub.atMs - lub.atMs).toBeLessThanOrEqual(140);
    expect(dub.peakGain).toBeLessThan(lub.peakGain);
  });

  it("stays gentle and low", () => {
    for (const b of [lub, dub]) {
      expect(b.peakGain).toBeLessThanOrEqual(HEART_BEAT_PEAK_GAIN);
      expect(b.peakGain).toBeGreaterThan(0);
      expect(b.startHz).toBeLessThanOrEqual(100);
      expect(b.endHz).toBeGreaterThanOrEqual(40);
      expect(b.endHz).toBeLessThanOrEqual(b.startHz);
      expect(b.attackMs).toBeGreaterThan(0);
    }
  });

  it("is over well before the hearts finish rising", () => {
    expect(heartbeatDurationMs()).toBeLessThan(500);
    expect(heartbeatDurationMs([])).toBe(0);
  });
});

describe("shouldPlayHeartbeat", () => {
  const ok: HeartbeatGate = { reducedMotion: false, documentHidden: false, callActive: false, audioAvailable: true };

  it("plays when nothing blocks it", () => {
    expect(shouldPlayHeartbeat(ok)).toBe(true);
  });

  it.each(["reducedMotion", "documentHidden", "callActive"] as const)("stays silent when %s", (key) => {
    expect(shouldPlayHeartbeat({ ...ok, [key]: true })).toBe(false);
  });

  it("stays silent without audio", () => {
    expect(shouldPlayHeartbeat({ ...ok, audioAvailable: false })).toBe(false);
  });
});
