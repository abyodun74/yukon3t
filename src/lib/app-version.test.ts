import { describe, it, expect } from "vitest";
import {
  checkAppVersionPolicy,
  compareVersions,
  decideUpdateStatus,
  isOpenableStoreLink,
  olderBuildTokenWhere,
  parseBuild,
  parseItunesLookup,
  parseMarketingVersion,
  parsePlatform,
  sanitizeAppStoreId,
  sanitizeStoreUrl,
  snoozeKey,
  sortBuildBreakdown,
  storeLinksFor,
  type AppVersionPolicyForm,
  type AppVersionPolicyRules,
} from "@/lib/app-version";

const policy = (overrides: Partial<AppVersionPolicyRules> = {}): AppVersionPolicyRules => ({
  enabled: true,
  latestBuild: 29,
  minBuild: null,
  latestVersion: null,
  message: null,
  storeUrl: null,
  appStoreId: null,
  iosAutoDetect: true,
  ...overrides,
});

describe("input sanitizing", () => {
  it("accepts only the two native platforms", () => {
    expect(parsePlatform("android")).toBe("android");
    expect(parsePlatform("ios")).toBe("ios");
    for (const bad of ["web", "Android", "", null, undefined, 1]) expect(parsePlatform(bad)).toBeNull();
  });

  it("parses a build as a positive integer within Android's versionCode range", () => {
    expect(parseBuild("29")).toBe(29);
    expect(parseBuild(" 29 ")).toBe(29);
    expect(parseBuild(29)).toBe(29);
    expect(parseBuild("2100000000")).toBe(2_100_000_000);
    for (const bad of ["0", "-1", "1.5", "29abc", "", "2100000001", "99999999999", null, undefined, 1.5]) {
      expect(parseBuild(bad), String(bad)).toBeNull();
    }
  });

  it("parses a marketing version of one to four numeric parts", () => {
    expect(parseMarketingVersion("1.26")).toBe("1.26");
    expect(parseMarketingVersion("2")).toBe("2");
    expect(parseMarketingVersion("1.2.3.4")).toBe("1.2.3.4");
    for (const bad of ["1.2.3.4.5", "1.x", "v1.2", "1..2", "", null, 126]) expect(parseMarketingVersion(bad)).toBeNull();
  });

  it("keeps only https store links and numeric App Store ids", () => {
    expect(sanitizeStoreUrl("https://apps.apple.com/app/id123456789")).toBe("https://apps.apple.com/app/id123456789");
    expect(sanitizeStoreUrl("https://play.google.com/store/apps/details?id=com.yukon3t.app")).toBe(
      "https://play.google.com/store/apps/details?id=com.yukon3t.app",
    );
    for (const bad of [
      "http://apps.apple.com/app/id1",
      "https://evil.example/app",
      "https://apps.apple.com.evil.example/",
      "javascript:alert(1)",
      "https://user:pw@apps.apple.com/",
      "not a url",
    ]) {
      expect(sanitizeStoreUrl(bad), bad).toBeNull();
    }
    expect(sanitizeAppStoreId("6743123456")).toBe("6743123456");
    expect(sanitizeAppStoreId(6743123456)).toBe("6743123456");
    for (const bad of ["id6743", "1234", "abc123456", ""]) expect(sanitizeAppStoreId(bad)).toBeNull();
  });
});

describe("compareVersions", () => {
  it("compares numerically, segment by segment", () => {
    expect(compareVersions("1.10", "1.9")).toBe(1);
    expect(compareVersions("1.9", "1.10")).toBe(-1);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("2", "1.99.99")).toBe(1);
    expect(compareVersions("1.26", "1.26")).toBe(0);
  });
});

describe("decideUpdateStatus", () => {
  const base = { platform: "android" as const, version: null, storeVersion: null };

  it("prompts nobody without an enabled policy", () => {
    expect(decideUpdateStatus({ ...base, policy: null, build: 1 })).toBe("current");
    expect(decideUpdateStatus({ ...base, policy: policy({ enabled: false, minBuild: 20 }), build: 1 })).toBe("current");
  });

  it("never prompts or blocks an unknown build", () => {
    expect(decideUpdateStatus({ ...base, policy: policy({ minBuild: 29 }), build: null })).toBe("current");
  });

  it("forces only below an owner-set minBuild", () => {
    expect(decideUpdateStatus({ ...base, policy: policy({ minBuild: 25 }), build: 24 })).toBe("force");
    expect(decideUpdateStatus({ ...base, policy: policy({ minBuild: 25 }), build: 25 })).toBe("soft");
    expect(decideUpdateStatus({ ...base, policy: policy({ minBuild: null }), build: 1 })).toBe("soft");
  });

  it("nudges below latestBuild and is current at or above it", () => {
    expect(decideUpdateStatus({ ...base, policy: policy(), build: 28 })).toBe("soft");
    expect(decideUpdateStatus({ ...base, policy: policy(), build: 29 })).toBe("current");
    expect(decideUpdateStatus({ ...base, policy: policy(), build: 30 })).toBe("current");
    expect(decideUpdateStatus({ ...base, policy: policy({ latestBuild: null }), build: 1 })).toBe("current");
  });

  it("prompts nobody until latestBuild is set, whatever else is", () => {
    const p = policy({ latestBuild: null, latestVersion: "1.26", minBuild: null });
    expect(decideUpdateStatus({ ...base, policy: p, build: 1, version: "1.0" })).toBe("current");
    expect(
      decideUpdateStatus({ policy: p, platform: "ios", build: 1, version: "1.0", storeVersion: "9.9" }),
    ).toBe("current");
  });

  it("nudges below latestVersion", () => {
    const p = policy({ latestBuild: 1, latestVersion: "1.26" });
    expect(decideUpdateStatus({ ...base, policy: p, build: 5, version: "1.25" })).toBe("soft");
    expect(decideUpdateStatus({ ...base, policy: p, build: 5, version: "1.26" })).toBe("current");
    expect(decideUpdateStatus({ ...base, policy: p, build: 5, version: null })).toBe("current");
  });

  it("uses the App Store's live version on iOS only, and only with auto-detect on", () => {
    const p = policy({ latestBuild: 1 });
    const ios = { policy: p, platform: "ios" as const, build: 5, version: "1.25" };
    expect(decideUpdateStatus({ ...ios, storeVersion: "1.26" })).toBe("soft");
    expect(decideUpdateStatus({ ...ios, storeVersion: "1.25" })).toBe("current");
    expect(decideUpdateStatus({ ...ios, storeVersion: null })).toBe("current");
    expect(decideUpdateStatus({ ...ios, policy: policy({ latestBuild: 1, iosAutoDetect: false }), storeVersion: "1.26" })).toBe(
      "current",
    );
    expect(decideUpdateStatus({ ...ios, platform: "android", storeVersion: "1.26" })).toBe("current");
  });
});

describe("store links", () => {
  it("sends Android to the Play listing, store app first", () => {
    expect(storeLinksFor("android", null)).toEqual({
      storeUrl: "https://play.google.com/store/apps/details?id=com.yukon3t.app",
      nativeUrl: "market://details?id=com.yukon3t.app",
    });
  });

  it("builds iOS links from the owner's App Store id, else the lookup's", () => {
    expect(storeLinksFor("ios", { storeUrl: null, appStoreId: "123456789" })).toEqual({
      storeUrl: "https://apps.apple.com/app/id123456789",
      nativeUrl: "itms-apps://apps.apple.com/app/id123456789",
    });
    expect(storeLinksFor("ios", null, { trackId: "987654321", trackViewUrl: null }).nativeUrl).toBe(
      "itms-apps://apps.apple.com/app/id987654321",
    );
    expect(storeLinksFor("ios", null)).toEqual({ storeUrl: null, nativeUrl: null });
  });

  it("lets a valid override replace both links, and ignores an invalid one", () => {
    const override = "https://apps.apple.com/us/app/yukon3t/id123456789";
    expect(storeLinksFor("android", { storeUrl: override, appStoreId: null })).toEqual({ storeUrl: override, nativeUrl: null });
    expect(storeLinksFor("android", { storeUrl: "https://evil.example", appStoreId: null }).nativeUrl).toBe(
      "market://details?id=com.yukon3t.app",
    );
  });

  it("only opens store links", () => {
    expect(isOpenableStoreLink("market://details?id=com.yukon3t.app")).toBe(true);
    expect(isOpenableStoreLink("itms-apps://apps.apple.com/app/id123456789")).toBe(true);
    expect(isOpenableStoreLink("https://apps.apple.com/app/id123456789")).toBe(true);
    for (const bad of ["market://details?id=com.evil", "market://details?id=com.yukon3t.app.evil", "itms-apps://evil/app/id1", "javascript:alert(1)", "/home", null]) {
      expect(isOpenableStoreLink(bad), String(bad)).toBe(false);
    }
  });

  it("reads the iTunes lookup answer defensively", () => {
    expect(
      parseItunesLookup({
        resultCount: 1,
        results: [{ version: "1.26", trackId: 123456789, trackViewUrl: "https://apps.apple.com/us/app/yukon3t/id123456789?uo=4" }],
      }),
    ).toEqual({ version: "1.26", trackId: "123456789", trackViewUrl: "https://apps.apple.com/us/app/yukon3t/id123456789?uo=4" });
    expect(parseItunesLookup({ resultCount: 0, results: [] })).toBeNull();
    expect(parseItunesLookup(null)).toBeNull();
    expect(parseItunesLookup({ results: [{ version: "<script>", trackId: "x", trackViewUrl: "http://x" }] })).toEqual({
      version: null,
      trackId: null,
      trackViewUrl: null,
    });
  });
});

describe("snoozeKey", () => {
  it("changes with the build and with the target release", () => {
    expect(snoozeKey("android", 27, 29)).not.toBe(snoozeKey("android", 28, 29));
    expect(snoozeKey("android", 27, 29)).not.toBe(snoozeKey("android", 27, 30));
    expect(snoozeKey("ios", 27, null)).toBe("ios:27:");
  });
});

describe("older-build token selection", () => {
  it("selects that platform's known builds below latestBuild, unknown builds only when asked", () => {
    expect(olderBuildTokenWhere("android", 29, false)).toEqual({ platform: "android", build: { lt: 29 } });
    expect(olderBuildTokenWhere("ios", 12, true)).toEqual({
      OR: [{ platform: "ios", build: { lt: 12 } }, { platform: "ios", build: null }],
    });
  });

  it("sorts the breakdown newest build first per platform, unknowns last", () => {
    expect(
      sortBuildBreakdown([
        { platform: "ios", build: null, count: 1 },
        { platform: "android", build: 27, count: 4 },
        { platform: null, build: null, count: 9 },
        { platform: "android", build: null, count: 2 },
        { platform: "android", build: 29, count: 3 },
      ]),
    ).toEqual([
      { platform: "android", build: 29, count: 3 },
      { platform: "android", build: 27, count: 4 },
      { platform: "android", build: null, count: 2 },
      { platform: "ios", build: null, count: 1 },
      { platform: "unknown", build: null, count: 9 },
    ]);
  });
});

describe("checkAppVersionPolicy", () => {
  const form = (overrides: Partial<AppVersionPolicyForm> = {}): AppVersionPolicyForm => ({
    enabled: true,
    iosAutoDetect: true,
    latestBuild: "29",
    minBuild: "",
    latestVersion: "",
    message: "",
    storeUrl: "",
    appStoreId: "",
    confirmMinBuild: "",
    ...overrides,
  });

  it("converts empty fields to null and keeps force off by default", () => {
    const result = checkAppVersionPolicy(form({ latestBuild: "" }), null);
    expect(result).toEqual({
      error: null,
      value: {
        enabled: true,
        iosAutoDetect: true,
        latestBuild: null,
        minBuild: null,
        latestVersion: null,
        message: null,
        storeUrl: null,
        appStoreId: null,
      },
    });
  });

  it("rejects malformed values", () => {
    expect(checkAppVersionPolicy(form({ latestBuild: "abc" }), null).error).toBe("invalid_latest_build");
    expect(checkAppVersionPolicy(form({ minBuild: "-3" }), null).error).toBe("invalid_min_build");
    expect(checkAppVersionPolicy(form({ latestVersion: "v1" }), null).error).toBe("invalid_version");
    expect(checkAppVersionPolicy(form({ storeUrl: "https://evil.example" }), null).error).toBe("invalid_store_url");
    expect(checkAppVersionPolicy(form({ appStoreId: "id12" }), null).error).toBe("invalid_app_store_id");
  });

  it("never lets minBuild block the latest build", () => {
    expect(checkAppVersionPolicy(form({ latestBuild: "", minBuild: "20", confirmMinBuild: "20" }), null).error).toBe(
      "min_build_needs_latest",
    );
    expect(checkAppVersionPolicy(form({ minBuild: "30", confirmMinBuild: "30" }), null).error).toBe("min_build_above_latest");
  });

  it("needs a new or changed minBuild typed again, but not an unchanged one", () => {
    expect(checkAppVersionPolicy(form({ minBuild: "25" }), null).error).toBe("confirm_force");
    expect(checkAppVersionPolicy(form({ minBuild: "25", confirmMinBuild: "24" }), null).error).toBe("confirm_force");
    expect(checkAppVersionPolicy(form({ minBuild: "25", confirmMinBuild: "25" }), null).error).toBeNull();
    expect(checkAppVersionPolicy(form({ minBuild: "26" }), 25).error).toBe("confirm_force");
    expect(checkAppVersionPolicy(form({ minBuild: "25" }), 25).error).toBeNull();
    // Clearing it (force off) needs no confirmation.
    expect(checkAppVersionPolicy(form({ minBuild: "" }), 25).error).toBeNull();
  });
});
