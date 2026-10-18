import { prisma } from "@/lib/prisma";
import {
  APP_PACKAGE_ID,
  parseItunesLookup,
  type AppPlatform,
  type AppVersionPolicyRules,
} from "@/lib/app-version";

// Server half of the update prompt (rules in app-version.ts). Both lookups are cached per server instance, because
// every installed app asks GET /api/app-version at launch: the policy row for a minute, the App Store's answer for an
// hour. Neither ever throws; a failure reads as "no policy" / "store version unknown", which prompts nobody.

const POLICY_TTL_MS = 60 * 1000;
const LOOKUP_TTL_MS = 60 * 60 * 1000;
const LOOKUP_FAILURE_TTL_MS = 10 * 60 * 1000;
const LOOKUP_TIMEOUT_MS = 3000;

const POLICY_SELECT = {
  enabled: true,
  latestBuild: true,
  minBuild: true,
  latestVersion: true,
  message: true,
  storeUrl: true,
  appStoreId: true,
  iosAutoDetect: true,
} as const;

const policyCache = new Map<AppPlatform, { value: AppVersionPolicyRules | null; expiresAt: number }>();

export async function getAppVersionPolicy(platform: AppPlatform): Promise<AppVersionPolicyRules | null> {
  const cached = policyCache.get(platform);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const value = await prisma.appVersionPolicy.findUnique({ where: { platform }, select: POLICY_SELECT });
    policyCache.set(platform, { value, expiresAt: Date.now() + POLICY_TTL_MS });
    return value;
  } catch (err) {
    console.error("[app-version] policy lookup failed", err);
    return null;
  }
}

/** After an admin edit, so this instance answers with it at once (others within POLICY_TTL_MS). */
export function forgetAppVersionPolicy(platform: AppPlatform) {
  policyCache.delete(platform);
}

type StoreLookup = NonNullable<ReturnType<typeof parseItunesLookup>>;
let lookupCache: { value: StoreLookup | null; expiresAt: number } | null = null;
let lookupInFlight: Promise<StoreLookup | null> | null = null;

/** The App Store's live listing for our bundle id (version, numeric id, URL), or null when unknown. */
export async function getAppStoreLookup(): Promise<StoreLookup | null> {
  if (lookupCache && lookupCache.expiresAt > Date.now()) return lookupCache.value;
  // One request per instance at a time, however many apps ask at once.
  lookupInFlight ??= (async () => {
    let value: StoreLookup | null = null;
    try {
      const response = await fetch(
        `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(APP_PACKAGE_ID)}`,
        { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS), cache: "no-store" },
      );
      if (response.ok) value = parseItunesLookup(await response.json());
    } catch {
      // Unknown, which prompts nobody.
    }
    lookupCache = { value, expiresAt: Date.now() + (value ? LOOKUP_TTL_MS : LOOKUP_FAILURE_TTL_MS) };
    return value;
  })().finally(() => {
    lookupInFlight = null;
  });
  return lookupInFlight;
}
