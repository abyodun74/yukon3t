import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import {
  APP_LINK_EXCLUDED_PATTERNS,
  CANONICAL_ORIGIN,
  IOS_APP_ID,
  appleAppSiteAssociation,
  canonicalUrl,
  classifyLink,
  inAppPathFor,
  launchUrlKey,
  needsDocumentLoad,
  openedUrlTarget,
} from "@/lib/app-links";
import { shouldKeepInApp } from "@/lib/in-app-link-guard";
import { isRepeatOpen, resetRepeatOpenForTests, REPEAT_OPEN_WINDOW_MS } from "@/lib/opened-url-dedupe";
import { GET as aasaRoute } from "@/app/.well-known/apple-app-site-association/route";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("classifyLink", () => {
  it("treats yukon3t.com and www.yukon3t.com links as in-app pages, keeping query and #fragment", () => {
    expect(classifyLink("https://yukon3t.com/post/abc")).toEqual({ kind: "internal", path: "/post/abc" });
    expect(classifyLink("https://www.yukon3t.com/u/1?story=2#x")).toEqual({ kind: "internal", path: "/u/1?story=2#x" });
    expect(classifyLink("http://YUKON3T.com/circles/a")).toEqual({ kind: "internal", path: "/circles/a" });
    expect(classifyLink("https://yukon3t.com")).toEqual({ kind: "internal", path: "/" });
  });

  it("resolves relative links against the page and counts the page's own host as in-app", () => {
    expect(classifyLink("/messages/1", "https://yukon3t.com/home")).toEqual({ kind: "internal", path: "/messages/1" });
    expect(classifyLink("/x", "https://yukon3t-git-main.vercel.app/home")).toEqual({ kind: "internal", path: "/x" });
    expect(classifyLink("http://localhost:3000/x?y=1", "http://localhost:3000/")).toEqual({
      kind: "internal",
      path: "/x?y=1",
    });
  });

  it("keeps other sites, preview hosts seen from production, lookalikes and odd ports external", () => {
    for (const href of [
      "https://example.com/post/1",
      "https://yukon3t.netlify.app/post/1",
      "https://yukon3t-abc.vercel.app/post/1",
      "https://yukon3t.com.evil.example/post/1",
      "https://evilyukon3t.com/",
      "https://yukon3t.com:8443/post/1",
      "https://user:pw@yukon3t.com/post/1",
    ]) {
      expect(classifyLink(href, "https://yukon3t.com/home").kind).toBe("external");
    }
  });

  it("leaves mailto/tel/sms to the OS and refuses javascript:, data: and garbage", () => {
    expect(classifyLink("mailto:hi@example.com").kind).toBe("scheme");
    expect(classifyLink("tel:+15550100").kind).toBe("scheme");
    expect(classifyLink("sms:+15550100").kind).toBe("scheme");
    for (const href of ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,x", "vbscript:x", "", null, "::"]) {
      expect(classifyLink(href).kind).toBe("unsafe");
    }
  });

  it("inAppPathFor is the path for in-app links only", () => {
    expect(inAppPathFor("https://yukon3t.com/muse/9")).toBe("/muse/9");
    expect(inAppPathFor("https://example.com/muse/9")).toBeNull();
    expect(inAppPathFor("mailto:a@b.c")).toBeNull();
  });
});

describe("canonicalUrl", () => {
  it("always builds https://yukon3t.com links", () => {
    expect(CANONICAL_ORIGIN).toBe("https://yukon3t.com");
    expect(canonicalUrl("/post/abc")).toBe("https://yukon3t.com/post/abc");
    expect(canonicalUrl("/circles/a%20b?x=1#y")).toBe("https://yukon3t.com/circles/a%20b?x=1#y");
  });

  it("never lets a path change the host", () => {
    expect(canonicalUrl("//evil.example/x")).toBe("https://yukon3t.com/");
    expect(canonicalUrl("https://evil.example/x")).toBe("https://yukon3t.com/");
    expect(canonicalUrl("/\\evil.example")).toBe("https://yukon3t.com/");
  });
});

describe("needsDocumentLoad", () => {
  it("loads route handlers and the reset page as documents, everything else in place", () => {
    expect(needsDocumentLoad("/api/auth/callback/resend?token=x&email=y")).toBe(true);
    expect(needsDocumentLoad("/reset-password#token=abc")).toBe(true);
    expect(needsDocumentLoad("/reset-password")).toBe(true);
    expect(needsDocumentLoad("/post/1")).toBe(false);
    expect(needsDocumentLoad("/reset-passwords")).toBe(false);
  });
});

describe("openedUrlTarget (a link that opened the app)", () => {
  it("routes a https://yukon3t.com link to its in-app path", () => {
    expect(openedUrlTarget("https://yukon3t.com/post/abc?x=1#c")).toEqual({
      path: "/post/abc?x=1#c",
      documentLoad: false,
      fromNotification: false,
    });
    expect(openedUrlTarget("https://www.yukon3t.com/u/1")?.path).toBe("/u/1");
  });

  it("loads an emailed sign-in or reset link as a document", () => {
    expect(openedUrlTarget("https://yukon3t.com/api/auth/callback/resend?token=t&email=a%40b.c")).toEqual({
      path: "/api/auth/callback/resend?token=t&email=a%40b.c",
      documentLoad: true,
      fromNotification: false,
    });
    expect(openedUrlTarget("https://yukon3t.com/reset-password#token=abc")?.documentLoad).toBe(true);
  });

  it("keeps the app's own notification link working", () => {
    expect(openedUrlTarget("yukon3t://open?path=%2Fu%2Fabc&n=1")).toEqual({
      path: "/u/abc",
      documentLoad: false,
      fromNotification: true,
    });
  });

  it("ignores ring links, share hand-offs, other hosts and plain http", () => {
    for (const raw of [
      "yukon3t://call?callId=1",
      "yukon3t://share",
      "https://example.com/post/1",
      "http://yukon3t.com/post/1",
      "https://yukon3t.com:444/post/1",
      "https://yukon3t.com.evil.example/x",
      "",
      42,
      null,
      `https://yukon3t.com/${"a".repeat(2100)}`,
    ]) {
      expect(openedUrlTarget(raw)).toBeNull();
    }
  });
});

describe("launchUrlKey", () => {
  it("keeps ordinary links as they are and never stores a sign-in or reset token", () => {
    const post = "https://yukon3t.com/post/1";
    expect(launchUrlKey(post, openedUrlTarget(post)!)).toBe(post);
    for (const url of [
      "https://yukon3t.com/reset-password#token=SECRETTOKEN123",
      "https://yukon3t.com/api/auth/callback/resend?token=SECRETTOKEN123&email=a%40b.c",
    ]) {
      const key = launchUrlKey(url, openedUrlTarget(url)!);
      expect(key).not.toContain("SECRETTOKEN123");
      expect(key).toBe(launchUrlKey(url, openedUrlTarget(url)!));
    }
    const a = "https://yukon3t.com/reset-password#token=one";
    const b = "https://yukon3t.com/reset-password#token=two";
    expect(launchUrlKey(a, openedUrlTarget(a)!)).not.toBe(launchUrlKey(b, openedUrlTarget(b)!));
  });
});

describe("isRepeatOpen", () => {
  beforeEach(() => resetRepeatOpenForTests());

  it("drops the same URL echoed within the window, not a later tap or another URL", () => {
    expect(isRepeatOpen("https://yukon3t.com/a", 1000)).toBe(false);
    expect(isRepeatOpen("https://yukon3t.com/a", 1500)).toBe(true);
    expect(isRepeatOpen("https://yukon3t.com/b", 1600)).toBe(false);
    expect(isRepeatOpen("https://yukon3t.com/b", 1600 + REPEAT_OPEN_WINDOW_MS)).toBe(false);
  });
});

describe("shouldKeepInApp (native link guard)", () => {
  it("takes over new-window links and links written with another YuKon3t host", () => {
    expect(shouldKeepInApp({ target: "_blank", linkHost: "yukon3t.com", pageHost: "yukon3t.com" })).toBe(true);
    expect(shouldKeepInApp({ target: "somewhere", linkHost: "yukon3t.com", pageHost: "yukon3t.com" })).toBe(true);
    expect(shouldKeepInApp({ target: null, linkHost: "www.yukon3t.com", pageHost: "yukon3t.com" })).toBe(true);
  });

  it("leaves same-window same-host links to the WebView", () => {
    expect(shouldKeepInApp({ target: null, linkHost: "yukon3t.com", pageHost: "yukon3t.com" })).toBe(false);
    expect(shouldKeepInApp({ target: "_self", linkHost: "yukon3t.com", pageHost: "yukon3t.com" })).toBe(false);
  });
});

describe("apple-app-site-association", () => {
  it("names the real team and bundle id from the Xcode project and capacitor config", () => {
    expect(IOS_APP_ID).toBe("3465L6ZHRJ.com.yukon3t.app");
    expect(read("ios/App/App.xcodeproj/project.pbxproj")).toContain("DEVELOPMENT_TEAM = 3465L6ZHRJ;");
    expect(read("capacitor.config.ts")).toContain('appId: "com.yukon3t.app"');
  });

  it("claims every page, the emailed sign-in callback first, and excludes APIs and assets", () => {
    const doc = appleAppSiteAssociation();
    expect(doc.applinks.details).toHaveLength(1);
    const [detail] = doc.applinks.details;
    expect(detail.appIDs).toEqual([IOS_APP_ID]);
    const comps = detail.components;
    expect(comps[0]).toMatchObject({ "/": "/api/auth/callback/*" });
    expect(comps[0].exclude).toBeUndefined();
    expect(comps[1]).toEqual({ "/": "/api/*", exclude: true });
    for (const pattern of APP_LINK_EXCLUDED_PATTERNS) {
      expect(comps).toContainEqual({ "/": pattern, exclude: true });
    }
    // The catch-all is last (first match wins) and is the only non-excluded entry besides the callback.
    expect(comps[comps.length - 1]).toMatchObject({ "/": "*" });
    expect(comps.filter((c) => !c.exclude)).toHaveLength(2);
    expect(doc.webcredentials.apps).toEqual([IOS_APP_ID]);
  });

  it("is served as application/json from the route handler, statically", async () => {
    const res = aasaRoute();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual(appleAppSiteAssociation());
    const source = read("src/app/.well-known/apple-app-site-association/route.ts");
    expect(source).toMatch(/export const dynamic = "force-static"/);
  });

  it("the proxy never runs on /.well-known/ (no nonce, cookie or rate limit for Apple's and Google's verifiers)", () => {
    const proxy = read("src/proxy.ts");
    const matcher = proxy.slice(proxy.indexOf("matcher:"));
    expect(matcher).toContain("\\\\.well-known/");
    const pattern = matcher.match(/"(\/\(\(\?![^"]+)"/)?.[1];
    expect(pattern).toBeTruthy();
    const re = new RegExp(`^${(pattern as string).replace(/\\\\/g, "\\")}$`);
    expect(re.test("/.well-known/apple-app-site-association")).toBe(false);
    expect(re.test("/.well-known/assetlinks.json")).toBe(false);
    expect(re.test("/post/abc")).toBe(true);
  });
});

describe("assetlinks.json (Android App Links)", () => {
  it("declares com.yukon3t.app with SHA-256 certificate fingerprints and URL handling", () => {
    const doc = JSON.parse(read("public/.well-known/assetlinks.json")) as {
      relation: string[];
      target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
    }[];
    expect(doc).toHaveLength(1);
    const [entry] = doc;
    expect(entry.relation).toContain("delegate_permission/common.handle_all_urls");
    expect(entry.target.namespace).toBe("android_app");
    expect(entry.target.package_name).toBe("com.yukon3t.app");
    expect(entry.target.sha256_cert_fingerprints.length).toBeGreaterThan(0);
    for (const fp of entry.target.sha256_cert_fingerprints) {
      expect(fp).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    }
  });
});

describe("share links use the canonical origin", () => {
  it("no share / invite / copy-link builder derives the host from the page", () => {
    for (const file of [
      "src/components/share-modal.tsx",
      "src/components/muse-share-modal.tsx",
      "src/components/copy-invite-link-button.tsx",
      "src/components/circle-share-sheet.tsx",
      "src/components/story-share-button.tsx",
      "src/components/link-copy-menu.tsx",
      "src/lib/native-share.ts",
      "src/lib/circle-share.ts",
      "src/lib/reset-token.ts",
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(/location\.origin/);
      expect(source, file).not.toMatch(/location\.host\b/);
    }
  });

  it("post, Muse and chat-invite links are built with canonicalUrl", () => {
    expect(read("src/components/share-modal.tsx")).toContain("canonicalUrl(`/post/${postId}`)");
    expect(read("src/components/muse-share-modal.tsx")).toContain("canonicalUrl(`/muse/${museId}`)");
    expect(read("src/components/copy-invite-link-button.tsx")).toContain("canonicalUrl(`/messages/${conversationId}`)");
    expect(read("src/lib/circle-share.ts")).toContain("${CANONICAL_ORIGIN}/circles/");
  });
});

describe("native app wiring (source guards)", () => {
  it("capacitor-bridge routes every URL that opened the app through openedUrlTarget", () => {
    const bridge = read("src/components/capacitor-bridge.tsx");
    expect(bridge).toMatch(/const launchTarget = openedUrlTarget\(launch\?\.url\)/);
    expect(bridge).toContain("claimLaunchUrl(launchUrlKey(launch.url, launchTarget))");
    expect(bridge).toMatch(/addListener\("appUrlOpen", \(event\) => \{\s*const target = openedUrlTarget\(event\.url\)/);
  });

  it("the in-app link guard is mounted in the root layout and is native-only", () => {
    expect(read("src/app/layout.tsx")).toContain("<InAppLinkGuard />");
    expect(read("src/components/in-app-link-guard.tsx")).toContain("if (!Capacitor.isNativePlatform()) return;");
  });

  it("the app never shows web-only sign-in prompts", () => {
    // Web push permission: the settings toggle stands down in the app (FCM/APNs is asked by capacitor-bridge).
    expect(read("src/components/push-notifications-toggle.tsx")).toMatch(
      /if \(Capacitor\.isNativePlatform\(\)\) \{\s*if \(!cancelled\) setStatus\("native"\)/,
    );
    // "You can close this tab" is the website's wording only.
    const checkEmail = read("src/app/sign-in/check-email/page.tsx");
    expect(checkEmail).toMatch(/<NativeAppSwitch[\s\S]*app=\{[\s\S]*checkEmailInApp[\s\S]*web=\{[\s\S]*closeTab/);
  });
});
