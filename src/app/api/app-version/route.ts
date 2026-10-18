import { NextResponse, type NextRequest } from "next/server";
import {
  decideUpdateStatus,
  parseBuild,
  parseMarketingVersion,
  parsePlatform,
  storeLinksFor,
  type AppUpdateStatus,
} from "@/lib/app-version";
import { getAppStoreLookup, getAppVersionPolicy } from "@/lib/app-version-server";

/**
 * Public, no auth — AppUpdateGate (native app only) asks this at launch and on foreground, at most every 6 hours
 * unless it is already blocked: `GET /api/app-version?p=android|ios&b=<build>&v=<marketing version>`.
 *
 * Answers `{ status: "current" | "soft" | "force", storeUrl, nativeUrl, message?, latestBuild? }`, decided by
 * decideUpdateStatus (src/lib/app-version.ts) from the owner's AppVersionPolicy on /admin/system. Anything missing or
 * malformed reads as "current": an unknown platform or build is never prompted, let alone blocked, and a prompt with
 * nowhere to send the user (no store link) isn't shown either. Rate limited like every other /api route by the
 * page-level limiter in src/proxy.ts; the policy and the App Store lookup are cached in app-version-server.ts.
 * `private` caching only: the proxy may set a cookie on this response, which must never be stored by a shared cache.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const platform = parsePlatform(params.get("p"));
  const build = parseBuild(params.get("b"));
  const version = parseMarketingVersion(params.get("v"));

  if (!platform) return answer({ status: "current", storeUrl: null, nativeUrl: null });

  const policy = await getAppVersionPolicy(platform);
  const wantsStoreLookup =
    platform === "ios" &&
    policy?.enabled === true &&
    policy.latestBuild !== null &&
    build !== null &&
    (policy.iosAutoDetect || !policy.appStoreId);
  const lookup = wantsStoreLookup ? await getAppStoreLookup() : null;

  let status: AppUpdateStatus = decideUpdateStatus({
    policy,
    platform,
    build,
    version,
    storeVersion: policy?.iosAutoDetect ? (lookup?.version ?? null) : null,
  });
  const links = storeLinksFor(platform, policy, lookup);
  if (!links.storeUrl) status = "current";

  if (status === "current") return answer({ status, storeUrl: links.storeUrl, nativeUrl: links.nativeUrl });
  return answer({
    status,
    ...links,
    ...(policy?.message ? { message: policy.message } : {}),
    ...(policy?.latestBuild != null ? { latestBuild: policy.latestBuild } : {}),
  });
}

function answer(body: Record<string, unknown>) {
  return NextResponse.json(body, { headers: { "Cache-Control": "private, max-age=60" } });
}
