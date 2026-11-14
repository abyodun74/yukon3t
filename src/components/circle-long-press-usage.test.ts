import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Every list of Circles gets the long-press / right-click share sheet through ONE wrapper, CircleLongPress
// (circle-long-press.tsx), never a per-page copy. This fails if a file renders a link to a Circle page
// (`/circles/${x.slug}`) without it, unless the link is reviewed below as not being a Circle list.

const SRC = join(process.cwd(), "src");
const rel = (p: string) => relative(SRC, p).split(sep).join("/");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) return entry === "generated" ? [] : files(p);
    return /\.tsx$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [p] : [];
  });
}

/** The Circle lists found (2026-11-13). Each must use the wrapper. */
const CIRCLE_LISTS = [
  "app/circles/page.tsx", // the Circles page ("My Circles" and every visible Circle)
  "app/search/page.tsx", // search results and smart (semantic) search results
  "components/sub-circle-list.tsx", // a main Circle's sub-circles
  "components/circle-switcher.tsx", // the rail of the viewer's own Circles (getMyCircles)
];

/** Links to a Circle page that are not a list of Circles. */
const NOT_A_LIST: Record<string, string> = {
  "app/circles/[slug]/page.tsx": "the 'Sub-circle of' breadcrumb and Back link (the page has the Share button instead)",
  "app/circles/new/page.tsx": "Back to the main Circle",
  "app/admin/circles/page.tsx": "admin clean-up list (site admins, includes PRIVATE Circles; not a share surface)",
  "components/channel-list.tsx": "channel links inside one Circle",
  "components/circle-share-sheet.tsx": "the share sheet's own 'Invite people' link (PRIVATE Circle, admins only)",
};

const CIRCLE_LINK = /href=\{`\/circles\/\$\{[^}]*slug[^}]*\}/;

describe("Circle lists use the shared long-press wrapper", () => {
  it("every known Circle list renders its Circles inside <CircleLongPress>", () => {
    for (const file of CIRCLE_LISTS) {
      const source = readFileSync(join(SRC, file), "utf8");
      expect(source, file).toMatch(/import \{[^}]*\bCircleLongPress\b[^}]*\} from "@\/components\/circle-long-press"/);
      const links = source.match(new RegExp(CIRCLE_LINK.source, "g")) ?? [];
      const wrappers = source.match(/<CircleLongPress\b/g) ?? [];
      expect(links.length, file).toBeGreaterThan(0);
      expect(wrappers.length, `${file}: one wrapper per Circle link`).toBe(links.length);
    }
  });

  it("no other file links to Circle pages without being reviewed", () => {
    const offenders = files(SRC)
      .map(rel)
      .filter((file) => CIRCLE_LINK.test(readFileSync(join(SRC, file), "utf8")))
      .filter((file) => !CIRCLE_LISTS.includes(file) && !(file in NOT_A_LIST));
    expect(offenders).toEqual([]);
  });

  it("the wrapper opts out of the app-wide link menu, blocks the callout and text selection, and keeps one sheet", () => {
    const source = readFileSync(join(SRC, "components", "circle-long-press.tsx"), "utf8");
    expect(source).toContain("data-no-link-menu");
    expect(source).toContain("[-webkit-touch-callout:none]");
    expect(source).toContain("select-none");
    expect(source).toContain("useLongPress(");
    expect(source).toContain("<CircleShareSheet");
  });

  it("the Circle page has the explicit, accessible Share button", () => {
    const page = readFileSync(join(SRC, "app", "circles", "[slug]", "page.tsx"), "utf8");
    expect(page).toContain("<CircleShareButton");
    const button = readFileSync(join(SRC, "components", "circle-long-press.tsx"), "utf8");
    expect(button).toMatch(/aria-label=\{t\.open\}/);
  });
});
