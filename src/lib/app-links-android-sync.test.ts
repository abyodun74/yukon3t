import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_LINK_EXCLUDED_PATTERNS, appleAppSiteAssociation } from "@/lib/app-links";

// The Android app's App Link filter claims all of https://yukon3t.com (a filter can't exclude paths before Android 15);
// AppLinkPolicy.java sends the excluded paths to the browser. It must exclude exactly what the iOS association file
// excludes, in the same order, or the two apps would disagree about which links stay in the app.
const javaSource = readFileSync(
  join(process.cwd(), "android/app/src/main/java/com/yukon3t/app/AppLinkPolicy.java"),
  "utf8",
);

function javaStringArray(name: string): string[] {
  const match = javaSource.match(new RegExp(`${name}\\s*=\\s*\\{([\\s\\S]*?)\\};`));
  if (!match) throw new Error(`${name} not found in AppLinkPolicy.java`);
  return [...match[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

describe("Android App Link exclusions match the iOS association file", () => {
  it("excludes /api/* and every APP_LINK_EXCLUDED_PATTERNS entry, in order", () => {
    expect(javaStringArray("EXCLUDED_PATTERNS")).toEqual(["/api/*", ...APP_LINK_EXCLUDED_PATTERNS]);
  });

  it("keeps emailed sign-in callbacks in the app, like the first AASA component", () => {
    const first = appleAppSiteAssociation().applinks.details[0].components[0];
    expect(first).toMatchObject({ "/": "/api/auth/callback/*" });
    expect(first).not.toHaveProperty("exclude");
    expect(javaSource).toContain('AUTH_CALLBACK_PREFIX = "/api/auth/callback/"');
  });
});
