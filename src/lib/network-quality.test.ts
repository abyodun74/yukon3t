import { describe, it, expect } from "vitest";
import {
  LATENCY_MAX_AGE_MS,
  LATENCY_SAMPLE_LIMIT,
  addLatencySample,
  classifyNetwork,
  feedPageSize,
  isLatencyProbeUrl,
  medianLatency,
  parseDataSaverPreference,
  parseFeedPageSize,
} from "./network-quality";

describe("classifyNetwork", () => {
  const online = { online: true };

  it("is offline whenever the device is offline, whatever the setting", () => {
    expect(classifyNetwork({ online: false })).toBe("offline");
    expect(classifyNetwork({ online: false }, "on")).toBe("offline");
    expect(classifyNetwork({ online: false }, "off")).toBe("offline");
  });

  it("is good with no hints at all (iOS, Firefox)", () => {
    expect(classifyNetwork(online)).toBe("good");
  });

  it("follows the Data saver setting before any hint", () => {
    expect(classifyNetwork({ ...online, effectiveType: "4g" }, "on")).toBe("slow");
    expect(classifyNetwork({ ...online, effectiveType: "2g", saveData: true }, "off")).toBe("good");
  });

  it("treats the browser's own data saver and slow effective types as slow", () => {
    expect(classifyNetwork({ ...online, saveData: true })).toBe("slow");
    for (const effectiveType of ["slow-2g", "2g", "3g"]) {
      expect(classifyNetwork({ ...online, effectiveType }), effectiveType).toBe("slow");
    }
    expect(classifyNetwork({ ...online, effectiveType: "4g" })).toBe("good");
  });

  it("uses downlink and rtt, ignoring Chrome's 0 = unknown", () => {
    expect(classifyNetwork({ ...online, effectiveType: "4g", downlinkMbps: 0.6 })).toBe("slow");
    expect(classifyNetwork({ ...online, effectiveType: "4g", downlinkMbps: 0 })).toBe("good");
    expect(classifyNetwork({ ...online, effectiveType: "4g", rttMs: 650 })).toBe("slow");
    expect(classifyNetwork({ ...online, effectiveType: "4g", rttMs: 0 })).toBe("good");
  });

  it("falls back to observed latency (congested 5G that still says 4g)", () => {
    expect(classifyNetwork({ ...online, effectiveType: "4g", observedLatencyMs: 3_000 })).toBe("slow");
    expect(classifyNetwork({ ...online, effectiveType: "4g", observedLatencyMs: 800 })).toBe("good");
    expect(classifyNetwork({ ...online, observedLatencyMs: null })).toBe("good");
  });
});

describe("parseDataSaverPreference", () => {
  it("accepts the three values and defaults everything else to auto", () => {
    expect(parseDataSaverPreference("on")).toBe("on");
    expect(parseDataSaverPreference("off")).toBe("off");
    expect(parseDataSaverPreference("auto")).toBe("auto");
    expect(parseDataSaverPreference(null)).toBe("auto");
    expect(parseDataSaverPreference("yes")).toBe("auto");
  });
});

describe("latency samples", () => {
  it("keeps only the newest samples", () => {
    let samples: { at: number; ms: number }[] = [];
    for (let i = 0; i < LATENCY_SAMPLE_LIMIT + 3; i++) samples = addLatencySample(samples, { at: i, ms: i });
    expect(samples).toHaveLength(LATENCY_SAMPLE_LIMIT);
    expect(samples[0]!.ms).toBe(3);
  });

  it("needs at least three recent samples and takes their median", () => {
    const now = 1_000_000;
    expect(medianLatency([{ at: now, ms: 9_000 }, { at: now, ms: 9_000 }], now)).toBeNull();
    expect(medianLatency([{ at: now, ms: 100 }, { at: now, ms: 9_000 }, { at: now, ms: 300 }], now)).toBe(300);
    expect(
      medianLatency([{ at: now, ms: 100 }, { at: now, ms: 200 }, { at: now, ms: 300 }, { at: now, ms: 400 }], now),
    ).toBe(250);
  });

  it("ignores samples older than the window", () => {
    const now = 1_000_000;
    const old = now - LATENCY_MAX_AGE_MS - 1;
    expect(medianLatency([{ at: old, ms: 9_000 }, { at: old, ms: 9_000 }, { at: now, ms: 100 }], now)).toBeNull();
  });
});

describe("isLatencyProbeUrl", () => {
  const origin = "https://yukon3t.com";

  it("counts RSC requests and the light read-only API routes", () => {
    expect(isLatencyProbeUrl("https://yukon3t.com/home?_rsc=abc", origin)).toBe(true);
    expect(isLatencyProbeUrl("/api/badge-counts", origin)).toBe(true);
    expect(isLatencyProbeUrl("/api/feed/all/latest?before=x", origin)).toBe(true);
  });

  it("ignores other origins, media and everything else", () => {
    expect(isLatencyProbeUrl("https://media.example.com/a.jpg?_rsc=1", origin)).toBe(false);
    expect(isLatencyProbeUrl("/api/avatar/u/x-t.jpg", origin)).toBe(false);
    expect(isLatencyProbeUrl("/home", origin)).toBe(false);
    expect(isLatencyProbeUrl("http://[bad", origin)).toBe(false);
  });
});

describe("feedPageSize", () => {
  it("halves the page on a slow connection only", () => {
    expect(feedPageSize("good")).toBe(20);
    expect(feedPageSize("offline")).toBe(20);
    expect(feedPageSize("slow")).toBe(10);
  });
});

describe("parseFeedPageSize", () => {
  it("clamps a requested page size to 5..20 and defaults to 20", () => {
    expect(parseFeedPageSize(null)).toBe(20);
    expect(parseFeedPageSize("abc")).toBe(20);
    expect(parseFeedPageSize("10")).toBe(10);
    expect(parseFeedPageSize("1")).toBe(5);
    expect(parseFeedPageSize("500")).toBe(20);
  });
});
