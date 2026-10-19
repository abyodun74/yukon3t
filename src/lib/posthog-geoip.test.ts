import { describe, expect, it } from "vitest";
import type { CaptureResult } from "posthog-js";
import { disablePostHogGeoIp } from "./posthog-geoip";

describe("disablePostHogGeoIp", () => {
  it("adds $geoip_disable to an event, keeping its other properties", () => {
    const event = {
      uuid: "u1",
      event: "$snapshot",
      properties: { $session_id: "s1" },
    } as CaptureResult;
    const out = disablePostHogGeoIp(event);
    expect(out?.properties).toEqual({ $session_id: "s1", $geoip_disable: true });
    expect(out?.uuid).toBe("u1");
    expect(event.properties).not.toHaveProperty("$geoip_disable");
  });

  it("overrides an explicit false", () => {
    const out = disablePostHogGeoIp({
      uuid: "u2",
      event: "$pageview",
      properties: { $geoip_disable: false },
    } as CaptureResult);
    expect(out?.properties.$geoip_disable).toBe(true);
  });

  it("passes a dropped (null) event through unchanged", () => {
    expect(disablePostHogGeoIp(null)).toBeNull();
  });
});
