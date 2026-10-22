import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// A PRIVATE Circle must not exist for anyone but its members (lib/circle-visibility.ts). These guard that from the
// source, in the style of avatar-exposure.test.ts: any query that lists Circles has to apply the visibility filter,
// unless it is on an explicit list of reviewed exceptions (a new unfiltered list is a decision, not an accident), and
// the Circle page has to 404 a non-member before rendering anything.

const SRC = "src";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) return entry === "generated" ? [] : files(p);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [p] : [];
  });
}

const rel = (p: string) => relative(SRC, p).split(sep).join("/");

/** The argument text of the call whose opening parenthesis is at `open`, up to its matching close. */
function callArgs(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) return source.slice(open, i + 1);
  }
  return source.slice(open);
}

const FILTER = /\b(visibleCircleWhere|visibleOrInvitedCircleWhere)\(/;

// Circle list queries that deliberately don't take the viewer filter, with the reason. Keyed by file, the number of
// such calls in it.
const UNFILTERED_CIRCLE_LISTS: Record<string, number> = {
  // createCircle's double-submit check: the caller's own Circles (createdById), never returned to a browser.
  "app/actions/circles.ts": 2, // + updateCircleDetails' own sub-circles when going private (a write, nothing listed)
  // Site-admin duplicate/spam clean-up page: lists every Circle by design (private ones without a link).
  "app/admin/circles/page.tsx": 1,
  // Circles the inviter created (createdById): the owner is always a member.
  "lib/collab-circle-options.ts": 1,
  "lib/collab-invites-server.ts": 1,
};

describe("queries that list Circles", () => {
  it("apply visibleCircleWhere, except a reviewed list of owner-only, admin-only and write paths", () => {
    const unfiltered: Record<string, number> = {};
    for (const file of files(SRC)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\.circle\.(findMany|findFirst)\(/g)) {
        const args = callArgs(source, match.index! + match[0].length - 1);
        if (!FILTER.test(args)) unfiltered[rel(file)] = (unfiltered[rel(file)] ?? 0) + 1;
      }
    }
    expect(unfiltered).toEqual(UNFILTERED_CIRCLE_LISTS);
  });

  it("filter a main Circle's sub-circles before the page lists them", () => {
    const page = readFileSync(join(SRC, "app", "circles", "[slug]", "page.tsx"), "utf8");
    const include = page.slice(page.indexOf("subCircles: {"));
    expect(include.slice(0, include.indexOf("}"))).toMatch(FILTER);
    // ...and only the ones the viewer may see (a standing invite checked) reach SubCircleList.
    expect(page).toMatch(/subCircles=\{visibleSubCircles\}/);
  });
});

describe("the Circle page", () => {
  const page = readFileSync(join(SRC, "app", "circles", "[slug]", "page.tsx"), "utf8");

  it("answers a non-member of a PRIVATE Circle with notFound() before loading anything inside it", () => {
    const gate = page.indexOf("if (!canSeeCircle(circle, { isMember, hasStandingInvite: !!myInvite })) notFound();");
    expect(gate).toBeGreaterThan(-1);
    for (const inside of ["prisma.post.findMany(", "prisma.circleMembership.findMany(", "prisma.liveStream.findMany(", "loadCircleEventPage(", "loadPollPage("]) {
      expect(page.indexOf(inside), inside).toBeGreaterThan(gate);
    }
  });

  it("never lets isCircleAdmin's site-admin shortcut open a PRIVATE Circle", () => {
    expect(page).toContain("const canModerate = !isPrivateNonMember && isCircleAdmin(");
  });

  it("has no request-to-join path for a PRIVATE Circle", () => {
    expect(page).not.toMatch(/hasPendingRequest|privateNotice/);
    const actions = readFileSync(join(SRC, "app", "actions", "circles.ts"), "utf8");
    expect(actions).not.toMatch(/circleJoinRequest\.create\(/);
  });
});

describe("notification lists", () => {
  it("apply circleNotificationVisibleWhere wherever notifications are listed or counted", () => {
    const offenders = files(SRC)
      .filter((file) => /prisma\.notification\.(findMany|count)\(/.test(readFileSync(file, "utf8")))
      .filter((file) => !readFileSync(file, "utf8").includes("circleNotificationVisibleWhere("))
      .map(rel)
      .sort();
    // markReadByTarget only marks rows read by their link; it returns nothing about them.
    expect(offenders).toEqual(["app/actions/notifications.ts"]);
  });
});
