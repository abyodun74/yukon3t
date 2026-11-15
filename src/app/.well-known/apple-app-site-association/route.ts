import { appleAppSiteAssociation } from "@/lib/app-links";

// iOS universal links: Apple's CDN fetches https://yukon3t.com/.well-known/apple-app-site-association (no extension,
// application/json, no redirect) to learn which paths the installed app (team 3465L6ZHRJ, com.yukon3t.app) opens.
// It only has an effect once an app build carries the applinks:yukon3t.com Associated Domains entitlement. Static: the
// document is the same for every request. src/proxy.ts skips /.well-known/ (no CSP nonce, cookie or rate limit).
export const dynamic = "force-static";

export function GET() {
  return new Response(JSON.stringify(appleAppSiteAssociation()), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
