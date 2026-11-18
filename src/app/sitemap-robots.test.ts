import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/lib/i18n/locales";
import { LEGAL_LAST_UPDATED } from "@/lib/seo";
import robots from "./robots";
import sitemap from "./sitemap";

const BASE = "https://yukon3t.com";
const APP_DIR = import.meta.dirname;

const entries = sitemap();
const rules = robots();
const disallow = (Array.isArray(rules.rules) ? rules.rules[0] : rules.rules).disallow as string[];

/** Whether robots.txt keeps crawlers out of `pathname` (prefix match, as robots.txt rules work). */
function blocked(pathname: string): boolean {
  return disallow.some((rule) => pathname.startsWith(rule));
}

/** Every page.tsx/layout.tsx under src/app, as its route ("/u/[userId]"), with its source. */
function routeFiles(dir = APP_DIR, out: { route: string; source: string }[] = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) routeFiles(full, out);
    else if (name === "page.tsx" || name === "layout.tsx") {
      const route = `/${path.relative(APP_DIR, dir).split(path.sep).join("/")}`.replace(/\/$/, "") || "/";
      out.push({ route, source: readFileSync(full, "utf8") });
    }
  }
  return out;
}

describe("sitemap", () => {
  it("lists the public pages on the canonical origin, and nothing behind a sign-in", () => {
    const paths = entries.map((entry) => new URL(entry.url));
    for (const url of paths) {
      expect(url.origin).toBe(BASE);
      expect(blocked(url.pathname), url.href).toBe(false);
    }
    const plain = [...new Set(paths.map((url) => url.pathname))].sort();
    expect(plain).toEqual(
      [
        "/",
        "/faq",
        "/sign-up",
        "/sign-in",
        "/advertise",
        "/legal/guidelines",
        "/legal/privacy",
        "/legal/terms",
        "/legal/disclaimer",
        "/legal/delete-account",
      ].sort(),
    );
    expect(new Set(entries.map((entry) => entry.url)).size).toBe(entries.length);
  });

  it("lists the landing page and the FAQ once per language, each with every hreflang alternate", () => {
    for (const page of ["/", "/faq"]) {
      const versions = entries.filter((entry) => new URL(entry.url).pathname === page);
      expect(versions.map((entry) => entry.url).sort()).toEqual(
        [`${BASE}${page}`, ...SUPPORTED_LOCALES.map((locale) => `${BASE}${page}?lang=${locale}`)].sort(),
      );
      for (const version of versions) {
        const languages = version.alternates?.languages as Record<string, string>;
        expect(languages["x-default"]).toBe(`${BASE}${page}`);
        for (const locale of SUPPORTED_LOCALES) expect(languages[locale]).toBe(`${BASE}${page}?lang=${locale}`);
      }
    }
    // No other page claims language versions it doesn't have.
    for (const entry of entries.filter((e) => !["/", "/faq"].includes(new URL(e.url).pathname))) {
      expect(entry.alternates, entry.url).toBeUndefined();
    }
  });

  it("dates the legal pages with the 'Last updated' they show, and invents no date for the rest", () => {
    for (const entry of entries) {
      const pathname = new URL(entry.url).pathname;
      if (!pathname.startsWith("/legal/")) {
        expect(entry.lastModified, entry.url).toBeUndefined();
        continue;
      }
      const source = readFileSync(path.join(APP_DIR, pathname, "page.tsx"), "utf8");
      const shown = source.match(/Last updated: ([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1];
      expect(shown, pathname).toBeDefined();
      const date = new Date(`${shown} 12:00 UTC`).toISOString().slice(0, 10);
      expect(LEGAL_LAST_UPDATED[pathname], pathname).toBe(date);
      expect(entry.lastModified).toBe(date);
    }
  });
});

describe("robots", () => {
  it("allows the site, points at the sitemap, and keeps the API out", () => {
    const rule = Array.isArray(rules.rules) ? rules.rules[0] : rules.rules;
    expect(rule.userAgent).toBe("*");
    expect(rule.allow).toBe("/");
    expect(rules.sitemap).toBe(`${BASE}/sitemap.xml`);
    expect(blocked("/api/avatar/x")).toBe(true);
  });

  it("disallows every page that needs a session", () => {
    const guarded = routeFiles().filter(({ source }) =>
      /\b(getOnboardedUserOrRedirect|getSessionUserOrRedirect|requireUser|requireAdmin)\s*\(/.test(source),
    );
    expect(guarded.length).toBeGreaterThan(20);
    for (const { route } of guarded) expect(blocked(route), route).toBe(true);
  });

  it("leaves the public pages and their ?lang= addresses crawlable", () => {
    for (const pathname of ["/", "/faq", "/sign-up", "/sign-in", "/advertise", "/try", "/legal/privacy"]) {
      expect(blocked(pathname), pathname).toBe(false);
    }
    expect(disallow.some((rule) => rule.includes("?") || rule.includes("lang"))).toBe(false);
  });
});
