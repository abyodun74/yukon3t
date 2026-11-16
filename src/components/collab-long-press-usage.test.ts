import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Every list of collabs gets the long-press / right-click share sheet through ONE wrapper, CollabLongPress
// (collab-long-press.tsx), never a per-page copy, exactly like Circles (circle-long-press-usage.test.ts). This fails if
// a file renders a link to a collab page (`/collab/${x.id}`) without it, unless the link is reviewed below as not
// being a collab list.

const SRC = join(process.cwd(), "src");
const rel = (p: string) => relative(SRC, p).split(sep).join("/");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) return entry === "generated" ? [] : files(p);
    return /\.tsx$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [p] : [];
  });
}

/** The collab lists found (2026-11-15). Each must use the wrapper. */
const COLLAB_LISTS = [
  "app/collab/page.tsx", // the Collab board (public OPEN collabs) and "Your private collabs"
  "app/search/page.tsx", // search results and smart (semantic) search results
];

/** Links to a collab page that are not a list of collabs. */
const NOT_A_LIST: Record<string, string> = {
  "app/collab/[id]/page.tsx": "the collab's own page: its Edit link (the page has the Share button instead)",
  "app/collab/[id]/edit/page.tsx": "Back to the collab",
  "app/admin/circles/page.tsx": "admin clean-up list (site admins, includes PRIVATE collabs; not a share surface)",
  "components/collab-share-sheet.tsx": "the share sheet's own 'Invite people' link (PRIVATE collab, admins only)",
};

// `/collab/${...}` in a JSX href or a fallbackHref: a page link (the /api/collab/... calendar links don't match).
const COLLAB_LINK = /[hH]ref=\{`\/collab\/\$\{/;

describe("collab lists use the shared long-press wrapper", () => {
  it("every known collab list renders its collabs inside <CollabLongPress>", () => {
    for (const file of COLLAB_LISTS) {
      const source = readFileSync(join(SRC, file), "utf8");
      expect(source, file).toMatch(/import \{[^}]*\bCollabLongPress\b[^}]*\} from "@\/components\/collab-long-press"/);
      const links = source.match(new RegExp(COLLAB_LINK.source, "g")) ?? [];
      const wrappers = source.match(/<CollabLongPress\b/g) ?? [];
      expect(links.length, file).toBeGreaterThan(0);
      expect(wrappers.length, `${file}: one wrapper per collab link`).toBe(links.length);
    }
  });

  it("no other file links to collab pages without being reviewed", () => {
    const offenders = files(SRC)
      .map(rel)
      .filter((file) => COLLAB_LINK.test(readFileSync(join(SRC, file), "utf8")))
      .filter((file) => !COLLAB_LISTS.includes(file) && !(file in NOT_A_LIST));
    expect(offenders).toEqual([]);
  });

  it("the wrapper opts out of the app-wide link menu, blocks the callout and text selection, and keeps one sheet", () => {
    const source = readFileSync(join(SRC, "components", "collab-long-press.tsx"), "utf8");
    expect(source).toContain("data-no-link-menu");
    expect(source).toContain("[-webkit-touch-callout:none]");
    expect(source).toContain("select-none");
    expect(source).toContain("useLongPress(");
    expect(source).toContain("<CollabShareSheet");
  });

  it("the collab page has the explicit, accessible Share button", () => {
    const page = readFileSync(join(SRC, "app", "collab", "[id]", "page.tsx"), "utf8");
    expect(page).toContain("<CollabShareButton");
    const button = readFileSync(join(SRC, "components", "collab-long-press.tsx"), "utf8");
    expect(button).toMatch(/aria-label=\{t\.open\}/);
  });

  it("the Circle and Collab sheets share one generic sheet (no copy of the share actions)", () => {
    for (const file of ["circle-share-sheet.tsx", "collab-share-sheet.tsx"]) {
      const source = readFileSync(join(SRC, "components", file), "utf8");
      expect(source, file).toContain("<ShareLinkSheet");
      expect(source, file).not.toContain('from "@/components/send-to-chats-picker"');
      expect(source, file).not.toContain('from "@/lib/native-share"');
    }
  });

  it("the private collab sheet's Invite link has its anchor on the collab page", () => {
    expect(readFileSync(join(SRC, "components", "collab-invite-manager.tsx"), "utf8")).toContain('id="collab-invites"');
  });
});
