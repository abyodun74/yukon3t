import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// A collab whose author is blocked either way with the viewer must not exist for them (lib/collab-visibility.ts).
// These guard that from the source, in the style of circle-visibility-exposure.test.ts: every query that lists collabs
// applies collabNotBlockedWhere, and every exported page / action / route that reads one collab for a viewer goes
// through the decision (collabHiddenFromViewer, or viewerCanSeeCollab / getCollabPollAccess, which call it), unless it
// is on an explicit list of reviewed exceptions (a new unchecked path is a decision, not an accident).

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

/** Each exported function of `source` with its body (up to the next export), by name. */
function exportedFunctions(source: string): { name: string; body: string }[] {
  const starts = [...source.matchAll(/^export (?:default )?(?:async )?function (\w+)/gm)];
  return starts.map((m, i) => ({
    name: m[1],
    body: source.slice(m.index!, i + 1 < starts.length ? starts[i + 1].index : source.length),
  }));
}

// Collab list queries that deliberately don't take the block filter, with the reason. Keyed by file, the count.
const UNFILTERED_COLLAB_LISTS: Record<string, number> = {
  // Site-admin duplicate/spam clean-up page (/admin/circles): lists every collab by design. A moderation view.
  "app/admin/circles/page.tsx": 1,
  // The moderation queue's preview of reported collabs: admin-only, server-rendered on /admin/moderation.
  "lib/report-content-preview.ts": 1,
  // The session-reminder cron's own candidates (nothing is listed to a person); each fan-out goes through
  // collabViewersOnly instead.
  "app/api/cron/collab-session-reminders/route.ts": 1,
};

const READS_ONE_COLLAB = /\.(collabBoardPost\.(findUnique|findFirst)|collabInvite\.findUnique|collabJoinRequest\.findUnique)\(/;
const DECISION = /\b(collabHiddenFromViewer|viewerCanSeeCollab|getCollabPollAccess)\(/;

// Exported functions that read one collab without the block decision, with the reason ("file#function").
const UNCHECKED_SINGLE_READS = new Set([
  // Author or site admin deleting a collab: the author is never blocked with themselves, and a site admin's delete is
  // moderation (also offered on /admin/circles).
  "app/actions/collab.ts#deleteCollabPost",
  // Not gated server-side for someone blocked with the author (it only removes their own participation); they have
  // no UI entry point to it, since the collab page 404s for them.
  "app/actions/collab.ts#leaveCollab",
  // The admin side of a report (resolveReport, the moderation queue): who a report is about. (Filing one,
  // reportableTargetAccused, does apply the rule, like a blocked author's post; the person stays reportable as USER.)
  "lib/report-target.ts#accusedUserIdOf",
  // Moderation actions (removeModeratedContent): site admins, from /admin/moderation.
  "lib/content-moderation.ts#removeModeratedContent",
]);

describe("queries that list collabs", () => {
  it("apply collabNotBlockedWhere, except a reviewed list of admin-only and cron paths", () => {
    const unfiltered: Record<string, number> = {};
    for (const file of files(SRC)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\.collabBoardPost\.findMany\(/g)) {
        const args = callArgs(source, match.index! + match[0].length - 1);
        if (!/\bcollabNotBlockedWhere\(/.test(args)) unfiltered[rel(file)] = (unfiltered[rel(file)] ?? 0) + 1;
      }
    }
    expect(unfiltered).toEqual(UNFILTERED_COLLAB_LISTS);
  });
});

describe("pages, actions and routes that read one collab", () => {
  it("go through collabHiddenFromViewer (or viewerCanSeeCollab / getCollabPollAccess), except reviewed paths", () => {
    const unchecked: string[] = [];
    for (const file of files(SRC)) {
      const source = readFileSync(file, "utf8");
      if (!READS_ONE_COLLAB.test(source)) continue;
      for (const fn of exportedFunctions(source)) {
        if (READS_ONE_COLLAB.test(fn.body) && !DECISION.test(fn.body)) unchecked.push(`${rel(file)}#${fn.name}`);
      }
    }
    expect(unchecked.sort()).toEqual([...UNCHECKED_SINGLE_READS].sort());
  });

  it("decide in one place: the helpers themselves call the block check", () => {
    const invites = readFileSync(join(SRC, "lib", "collab-invites-server.ts"), "utf8");
    const canSee = invites.slice(invites.indexOf("export async function viewerCanSeeCollab"));
    expect(canSee.slice(0, canSee.indexOf("\n}\n"))).toMatch(/collabHiddenFromViewer\(collab, viewer\.id\)/);
    const polls = readFileSync(join(SRC, "lib", "polls-data.ts"), "utf8");
    const access = polls.slice(polls.indexOf("export async function getCollabPollAccess"));
    expect(access.slice(0, access.indexOf("\n}\n"))).toMatch(/collabHiddenFromViewer\(collab, viewer\.id\)/);
  });
});

describe("the collab page", () => {
  const page = readFileSync(join(SRC, "app", "collab", "[id]", "page.tsx"), "utf8");

  it("answers a blocked viewer with notFound() before loading anything about the collab", () => {
    const gate = page.indexOf("if (await collabHiddenFromViewer(collab, me.id)) notFound();");
    expect(gate).toBeGreaterThan(page.indexOf("if (!collab) notFound();"));
    for (const inside of [
      "loadStandingCollabInvite(",
      "hasLiveCollabSession(",
      "getAuthorEngagementStatus(",
      "getCollabPollAccess(",
      "prisma.collabOneOffSession.findMany(",
      "prisma.collabParticipant.findMany(",
      "prisma.collabJoinRequest.findMany(",
      "prisma.conversation.findUnique(",
      "prisma.message.findMany(",
    ]) {
      expect(page.indexOf(inside), inside).toBeGreaterThan(gate);
    }
  });
});

describe("fan-outs about a collab", () => {
  it("skip people blocked either way with its author (collabViewersOnly)", () => {
    const session = readFileSync(join(SRC, "app", "actions", "collab-session.ts"), "utf8");
    const notify = session.slice(session.indexOf("async function notifyCollabSessionStarted"));
    expect(notify.slice(0, notify.indexOf("\n}\n"))).toMatch(/collabViewersOnly\(/);
    const cron = readFileSync(join(SRC, "app", "api", "cron", "collab-session-reminders", "route.ts"), "utf8");
    const reminders = cron.slice(cron.indexOf("async function sendSessionReminders"));
    expect(reminders.slice(0, reminders.indexOf("\n}\n"))).toMatch(/collabViewersOnly\(/);
    const polls = readFileSync(join(SRC, "app", "actions", "polls.ts"), "utf8");
    for (const fn of ["async function notifyPollCreated", "async function notifyPollScheduled"]) {
      const body = polls.slice(polls.indexOf(fn));
      expect(body.slice(0, body.indexOf("\n}\n")), fn).toMatch(/collabViewersOnly\(/);
    }
  });
});

describe("notification lists", () => {
  it("apply collabNotificationVisibleWhere wherever notifications are listed or counted", () => {
    const offenders = files(SRC)
      .filter((file) => /prisma\.notification\.(findMany|count)\(/.test(readFileSync(file, "utf8")))
      .filter((file) => !readFileSync(file, "utf8").includes("collabNotificationVisibleWhere("))
      .map(rel)
      .sort();
    // Same reviewed exceptions as circleNotificationVisibleWhere (circle-visibility-exposure.test.ts): neither shows rows.
    expect(offenders).toEqual(["app/actions/notifications.ts", "lib/new-member-alerts-data.ts"]);
  });
});
