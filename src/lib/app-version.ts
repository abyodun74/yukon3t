// "Please update the app" — the rules, pure and client-safe. The owner sets a policy per native platform on
// /admin/system (AppVersionPolicy); GET /api/app-version answers an installed app with decideUpdateStatus's verdict;
// AppUpdateGate shows the soft banner or the force screen. Force comes only from an owner-set minBuild, and an app
// that doesn't say which build it is is never prompted at all.

export const APP_PLATFORMS = ["android", "ios"] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];
export type AppUpdateStatus = "current" | "soft" | "force";

// Android applicationId and iOS bundle id (capacitor.config.ts appId).
export const APP_PACKAGE_ID = "com.yukon3t.app";

// Android's own ceiling on versionCode; anything above it isn't a real build.
export const MAX_BUILD = 2_100_000_000;
export const MESSAGE_MAX_LENGTH = 280;

/** How often the app asks /api/app-version while nothing is due: at launch and on foreground, at most this often. */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** "Not now" on the soft banner hides it this long, for that build and that target release. */
export const SOFT_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
/** "Notify users on older builds" can be sent at most once per platform in this window. */
export const UPDATE_NOTICE_COOLDOWN_MS = 60 * 60 * 1000;

export type AppVersionPolicyRules = {
  enabled: boolean;
  latestBuild: number | null;
  minBuild: number | null;
  latestVersion: string | null;
  message: string | null;
  storeUrl: string | null;
  appStoreId: string | null;
  iosAutoDetect: boolean;
};

export function parsePlatform(value: unknown): AppPlatform | null {
  return typeof value === "string" && (APP_PLATFORMS as readonly string[]).includes(value) ? (value as AppPlatform) : null;
}

/** A store build number (versionCode / CFBundleVersion) as a positive integer, or null for anything else. */
export function parseBuild(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,10}$/.test(text)) return null;
  const build = Number(text);
  return build >= 1 && build <= MAX_BUILD ? build : null;
}

/** A marketing version ("1.26", "2.0.1"): one to four dot-separated numbers, or null. */
export function parseMarketingVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return /^\d{1,6}(\.\d{1,6}){0,3}$/.test(text) ? text : null;
}

/** Numeric, segment by segment, a missing segment counting as 0: "1.10" > "1.9", "1.2" == "1.2.0". */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i] ?? 0;
    const y = right[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

const STORE_HOSTS = new Set(["play.google.com", "apps.apple.com", "itunes.apple.com"]);

/** An https link to Google Play or the App Store, or null. The only store links the app is ever told to open. */
export function sanitizeStoreUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && STORE_HOSTS.has(url.hostname) && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** An App Store numeric app id ("6743…"), or null. */
export function sanitizeAppStoreId(value: unknown): string | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  return /^\d{5,15}$/.test(text) ? text : null;
}

/**
 * What an installed app should be told. `build`/`version` are what the app reported (already sanitized; null when
 * missing or malformed), `storeVersion` the App Store's live version for iOS auto-detect (null when unknown).
 */
export function decideUpdateStatus(input: {
  policy: AppVersionPolicyRules | null;
  platform: AppPlatform;
  build: number | null;
  version: string | null;
  storeVersion: string | null;
}): AppUpdateStatus {
  const { policy, platform, build, version, storeVersion } = input;
  // No policy, switched off, no latestBuild set yet, or an app that didn't say which build it is: never prompted,
  // never blocked. latestBuild is the owner's "this is the release" switch; latestVersion and iOS auto-detect only
  // add to it.
  if (!policy || !policy.enabled || policy.latestBuild === null || build === null) return "current";
  if (policy.minBuild !== null && build < policy.minBuild) return "force";
  if (build < policy.latestBuild) return "soft";
  if (version !== null && policy.latestVersion !== null && compareVersions(version, policy.latestVersion) < 0) {
    return "soft";
  }
  if (
    platform === "ios" &&
    policy.iosAutoDetect &&
    version !== null &&
    storeVersion !== null &&
    compareVersions(version, storeVersion) < 0
  ) {
    return "soft";
  }
  return "current";
}

export type StoreLinks = {
  /** https listing, always openable. Null when there's nowhere to send the user (no prompt is shown then). */
  storeUrl: string | null;
  /** The store app's own scheme (market://, itms-apps://), tried first. */
  nativeUrl: string | null;
};

/** Where the Update button goes. An owner-set storeUrl replaces both links. `lookup` is the iOS store lookup, if any. */
export function storeLinksFor(
  platform: AppPlatform,
  policy: Pick<AppVersionPolicyRules, "storeUrl" | "appStoreId"> | null,
  lookup: { trackId: string | null; trackViewUrl: string | null } | null = null,
): StoreLinks {
  const override = sanitizeStoreUrl(policy?.storeUrl);
  if (override) return { storeUrl: override, nativeUrl: null };
  if (platform === "android") {
    return {
      storeUrl: `https://play.google.com/store/apps/details?id=${APP_PACKAGE_ID}`,
      nativeUrl: `market://details?id=${APP_PACKAGE_ID}`,
    };
  }
  const id = sanitizeAppStoreId(policy?.appStoreId) ?? sanitizeAppStoreId(lookup?.trackId);
  if (id) return { storeUrl: `https://apps.apple.com/app/id${id}`, nativeUrl: `itms-apps://apps.apple.com/app/id${id}` };
  return { storeUrl: sanitizeStoreUrl(lookup?.trackViewUrl), nativeUrl: null };
}

/** Whether a link the API handed back is one the app may open: a store https link or a store app's own scheme. */
export function isOpenableStoreLink(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value === `market://details?id=${APP_PACKAGE_ID}`) return true;
  if (/^itms-apps:\/\/apps\.apple\.com\/app\/id\d{5,15}$/.test(value)) return true;
  return sanitizeStoreUrl(value) === value;
}

/** The App Store's answer for our bundle id (itunes.apple.com/lookup), reduced to what we use. */
export function parseItunesLookup(json: unknown): { version: string | null; trackId: string | null; trackViewUrl: string | null } | null {
  if (!json || typeof json !== "object") return null;
  const results = (json as { results?: unknown }).results;
  if (!Array.isArray(results) || results.length === 0) return null;
  const first = results[0] as Record<string, unknown> | null;
  if (!first || typeof first !== "object") return null;
  return {
    version: parseMarketingVersion(first.version),
    trackId: sanitizeAppStoreId(first.trackId),
    trackViewUrl: sanitizeStoreUrl(first.trackViewUrl),
  };
}

/** The key a "Not now" is remembered under: this platform and build, against this target release. */
export function snoozeKey(platform: AppPlatform, build: number, target: number | string | null): string {
  return `${platform}:${build}:${target ?? ""}`;
}

/** The FcmToken filter for "Notify users on older builds": that platform, a known build below latestBuild. */
export function olderBuildTokenWhere(platform: AppPlatform, latestBuild: number, includeUnknownBuild: boolean) {
  const older = { platform, build: { lt: latestBuild } };
  return includeUnknownBuild ? { OR: [older, { platform, build: null }] } : older;
}

export type BuildBreakdownRow = { platform: string | null; build: number | null; count: number };

/** Token counts per platform and build, newest build first, unknown build last; null platforms as "unknown". */
export function sortBuildBreakdown(rows: BuildBreakdownRow[]): Array<{ platform: string; build: number | null; count: number }> {
  return rows
    .map((row) => ({ platform: row.platform ?? "unknown", build: row.build, count: row.count }))
    .sort((a, b) => {
      if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);
      if (a.build === null) return b.build === null ? 0 : 1;
      if (b.build === null) return -1;
      return b.build - a.build;
    });
}

export type AppVersionPolicyForm = {
  enabled: boolean;
  iosAutoDetect: boolean;
  latestBuild: string;
  minBuild: string;
  latestVersion: string;
  message: string;
  storeUrl: string;
  appStoreId: string;
  confirmMinBuild: string;
};

export type AppVersionPolicyFormError =
  | "invalid_latest_build"
  | "invalid_min_build"
  | "min_build_needs_latest"
  | "min_build_above_latest"
  | "invalid_version"
  | "invalid_store_url"
  | "invalid_app_store_id"
  | "confirm_force";

/**
 * The admin form, checked and converted (empty = not set). A minBuild must sit at or below latestBuild, so the build
 * the owner calls current can never be blocked; and a new or changed minBuild must be typed again in
 * `confirmMinBuild`, the force-update confirmation. `currentMinBuild` is what's stored now.
 */
export function checkAppVersionPolicy(
  form: AppVersionPolicyForm,
  currentMinBuild: number | null,
): { error: AppVersionPolicyFormError } | { error: null; value: AppVersionPolicyRules } {
  const latestBuild = form.latestBuild ? parseBuild(form.latestBuild) : null;
  if (form.latestBuild && latestBuild === null) return { error: "invalid_latest_build" };
  const minBuild = form.minBuild ? parseBuild(form.minBuild) : null;
  if (form.minBuild && minBuild === null) return { error: "invalid_min_build" };
  if (minBuild !== null && latestBuild === null) return { error: "min_build_needs_latest" };
  if (minBuild !== null && latestBuild !== null && minBuild > latestBuild) return { error: "min_build_above_latest" };
  const latestVersion = form.latestVersion ? parseMarketingVersion(form.latestVersion) : null;
  if (form.latestVersion && latestVersion === null) return { error: "invalid_version" };
  const storeUrl = form.storeUrl ? sanitizeStoreUrl(form.storeUrl) : null;
  if (form.storeUrl && storeUrl === null) return { error: "invalid_store_url" };
  const appStoreId = form.appStoreId ? sanitizeAppStoreId(form.appStoreId) : null;
  if (form.appStoreId && appStoreId === null) return { error: "invalid_app_store_id" };
  if (minBuild !== null && minBuild !== currentMinBuild && parseBuild(form.confirmMinBuild) !== minBuild) {
    return { error: "confirm_force" };
  }
  return {
    error: null,
    value: {
      enabled: form.enabled,
      iosAutoDetect: form.iosAutoDetect,
      latestBuild,
      minBuild,
      latestVersion,
      message: form.message.trim().slice(0, MESSAGE_MAX_LENGTH) || null,
      storeUrl,
      appStoreId,
    },
  };
}
