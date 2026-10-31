import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Private profile pictures are only useful if nothing a signed-out visitor or a crawler can load
// renders or returns one. These guard that from the source: a page or route that shows avatars must require a
// session, the pages that don't are an explicit list (a new public page is a decision, not an accident), and none of
// those public pages render an avatar.

const APP = join("src", "app");
const AVATAR_IDENTIFIERS = /\b(avatarUrl|UserAvatar|UserLink|ProfileStoryRing|StoryTray|authorAvatarUrl)\b/;
// requireViewer/requireVerifiedViewer need a session too: a member's, or a guest preview session (src/lib/guest-preview.ts),
// which sees avatars exactly as a signed-in member does.
const SESSION_GUARDS = /\b(getOnboardedUserOrRedirect|getSessionUserOrRedirect|requireUser|requireVerifiedUser|requireViewer|requireVerifiedViewer)\b/;

// Every page.tsx that may render for a signed-out visitor. Keep it in step with sitemap.ts / robots.ts.
const PUBLIC_PAGES = [
  "advertise/page.tsx",
  "advertise/success/page.tsx",
  "faq/page.tsx",
  "forgot-password/page.tsx",
  "legal/delete-account/page.tsx",
  "legal/disclaimer/page.tsx",
  "legal/guidelines/page.tsx",
  "legal/privacy/page.tsx",
  "legal/terms/page.tsx",
  "page.tsx",
  "reset-password/page.tsx",
  "sign-in/check-email/page.tsx",
  "sign-in/page.tsx",
  "sign-in/verify-device/page.tsx",
  "sign-up/page.tsx",
  "sign-up/verify-phone/page.tsx",
  // "Explore YuKon3t as a guest": an explanation and one button, no avatars.
  "try/page.tsx",
  "verify-email/page.tsx",
].sort();

function files(dir: string, name: RegExp): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) return files(p, name);
    return name.test(entry) ? [p] : [];
  });
}

const rel = (p: string) => relative(APP, p).split(sep).join("/");
const pages = files(APP, /^page\.tsx$/);

/** The source of a page plus every component it imports directly (one level: where an avatar would come from). */
function pageAndDirectComponents(page: string): string {
  const source = readFileSync(page, "utf8");
  const imported = [...source.matchAll(/from\s+["']@\/components\/([\w/-]+)["']/g)].map((m) =>
    join("src", "components", `${m[1]}.tsx`),
  );
  return [source, ...imported.filter((p) => statSync(p, { throwIfNoEntry: false })?.isFile()).map((p) => readFileSync(p, "utf8"))].join("\n");
}

describe("pages that can render avatars", () => {
  it("require a session, except for an explicit list of public pages", () => {
    const unguarded = pages.filter((p) => !SESSION_GUARDS.test(readFileSync(p, "utf8"))).map(rel).sort();
    expect(unguarded).toEqual(PUBLIC_PAGES);
  });

  it("none of the public pages (or the components they import) render an avatar", () => {
    const offenders = pages
      .filter((p) => PUBLIC_PAGES.includes(rel(p)))
      .filter((p) => AVATAR_IDENTIFIERS.test(pageAndDirectComponents(p)))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("route handlers that return avatars", () => {
  it("require a session, or sign the avatar for an external client", () => {
    const offenders = files(join(APP, "api"), /^route\.ts$/)
      .filter((p) => !p.includes(join("api", "avatar")))
      .filter((p) => AVATAR_IDENTIFIERS.test(readFileSync(p, "utf8")))
      .filter((p) => {
        const source = readFileSync(p, "utf8");
        return !SESSION_GUARDS.test(source) && !source.includes("avatarUrlForExternalClient");
      })
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("the avatar route itself refuses anyone without a session before touching storage", () => {
    const source = readFileSync(join(APP, "api", "avatar", "[...key]", "route.ts"), "utf8");
    const sessionCheck = source.indexOf("if (!viewerId) return refuse(401)");
    expect(sessionCheck).toBeGreaterThan(-1);
    expect(sessionCheck).toBeLessThan(source.indexOf("presignAvatarForViewer("));
    expect(sessionCheck).toBeLessThan(source.indexOf("checkRateLimit("));
  });
});
