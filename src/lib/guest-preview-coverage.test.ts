import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guest preview is read-only because requireUser() refuses a guest session (src/lib/auth-guards.ts) and every write
// path goes through it. This test reads the source and fails when that stops being provably true:
// - every exported Server Action in src/app/actions must either call a member guard (requireUser / requireVerifiedUser
//   / requireAdmin, directly or through a same-file helper), or be listed below: GUEST_READ_ALLOWED (read-only, calls
//   requireViewer / requireVerifiedViewer) or PUBLIC_NO_SESSION (no session needed at all, each with its reason);
// - nothing else in the app reaches for requireViewer except the places listed in VIEWER_CALLERS.
// Adding a read-only action a guest needs means adding it to GUEST_READ_ALLOWED here, deliberately.

const ROOT = process.cwd();
const ACTIONS_DIR = join(ROOT, "src/app/actions");

/** Read-only actions a guest preview session may call (they use requireViewer / requireVerifiedViewer). */
const GUEST_READ_ALLOWED: Record<string, readonly string[]> = {
  "circle-events.ts": ["loadCircleEvents", "loadCircleEventDetails"],
  "circle-voice.ts": ["getCircleVoiceParticipants"],
  "circles.ts": ["getMyCircles", "loadMoreCirclePosts"],
  "collab-session.ts": ["getCollabSessionParticipants"],
  "comments.ts": ["getPostComments"],
  "discover.ts": ["getPeopleYouMayKnow", "loadMoreDiscoverPeople"],
  "likes.ts": ["getPostLikers"],
  // Cost-bounded: its own linkSafetyCheck limiter, and it is a safety feature (warns before opening a bad link).
  "link-safety.ts": ["checkLinkBeforeOpen"],
  "live-streams.ts": [
    "getActiveLiveStreams",
    "getLiveStreamViewerCount",
    "getLiveStreamComments",
    "getLiveStreamStageUserIds",
    "getMyLiveStreamStatus",
  ],
  "muse.ts": ["getMuseFeed", "getMuseById", "getMuseReactionSummary", "getMuseComments"],
  "polls.ts": ["loadPolls"],
  "posts.ts": ["loadMoreProfilePosts"],
  "search.ts": ["loadMoreSearchPosts"],
  "stories.ts": ["getConnectionsStories", "getStory", "getStoryReactionSummary", "getStoryComments"],
  "subscriptions.ts": ["loadMoreSubscribers", "loadMoreSubscribing"],
};

/** Actions that need no session at all, so a guest calls them exactly like a signed-out visitor. Reason for each. */
const PUBLIC_NO_SESSION: Record<string, Record<string, string>> = {
  "ads.ts": {
    getActiveAdForDisplay: "public ad slot, also shown signed out",
    recordAdImpression: "public ad slot counter, also counted signed out",
    recordAdClick: "public ad slot counter, also counted signed out",
    requestAdUploadUrl: "public /advertise booking flow (Turnstile + limiter), not tied to an account",
    createAdCampaign: "public /advertise booking flow (Turnstile + limiter), not tied to an account",
  },
  "apple-auth.ts": { startAppleSignIn: "starts a sign-in; replaces the guest session" },
  "auth.ts": { signOutAction: "signing out is always allowed" },
  "guest-preview.ts": {
    startGuestPreview: "starts a guest session (kill switch, Turnstile, per-IP and global limiters)",
    leaveGuestPreview: "ends a guest session on the way to sign-up / sign-in; never signs a member out",
  },
  "locale.ts": { setLocale: "sets the language cookie; skips the account write for a guest session" },
  "password-auth.ts": {
    ensureFreshEmailOtp: "sign-up flow, keyed on the pending sign-up cookie, not the session",
    signUpWithPassword: "sign-up; issues a member session that replaces the guest one",
    confirmEmailOtp: "sign-up flow",
    resendEmailOtp: "sign-up flow",
    switchToPhoneVerification: "sign-up flow",
    switchToEmailVerification: "sign-up flow",
    loginWithPassword: "sign-in; refuses the guest row itself",
    confirmLoginDeviceChallenge: "sign-in flow",
    resendLoginDeviceChallenge: "sign-in flow",
    requestPasswordReset: "public password reset request",
    resetPassword: "public password reset with an emailed token",
  },
  "signup-phone-verification.ts": {
    requestSignupPhoneVerification: "sign-up flow, keyed on the pending sign-up",
    confirmSignupPhoneVerification: "sign-up flow, keyed on the pending sign-up",
  },
};

/** Files outside src/app/actions allowed to call requireViewer / requireVerifiedViewer (each is read-only). */
const VIEWER_CALLERS = [
  "src/lib/auth-guards.ts",
  "src/lib/page-guards.ts",
  "src/app/api/badge-counts/route.ts",
  "src/app/api/feed/[category]/latest/route.ts",
];

const MEMBER_GUARD = /\brequire(?:User|VerifiedUser|Admin)\s*\(/;
const VIEWER_GUARD = /\brequire(?:Viewer|VerifiedViewer)\s*\(/;

/** Blanks out comments and string/template contents so braces inside them don't confuse the scanner. */
function stripCommentsAndStrings(src: string): string {
  let out = "";
  let i = 0;
  const templateStack: number[] = [];
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      out += " ";
      continue;
    }
    if (c === '"' || c === "'") {
      out += c;
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\") i++;
        i++;
      }
      out += c;
      i++;
      continue;
    }
    if (c === "`" || (c === "}" && templateStack.length && templateStack[templateStack.length - 1] === 0)) {
      if (c === "}") templateStack.pop();
      out += c === "}" ? "}" : "`";
      i++;
      while (i < src.length && src[i] !== "`") {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === "$" && src[i + 1] === "{") {
          templateStack.push(0);
          out += "${";
          i += 2;
          break;
        }
        i++;
      }
      if (src[i] === "`") {
        out += "`";
        i++;
      }
      continue;
    }
    if (templateStack.length) {
      if (c === "{") templateStack[templateStack.length - 1]++;
      else if (c === "}") templateStack[templateStack.length - 1]--;
    }
    out += c;
    i++;
  }
  return out;
}

/** The body (between its braces) of the function whose declaration starts at `start`. */
function functionBody(code: string, start: number): string {
  // Parameters: from the first "(" after the name to its matching ")".
  let i = code.indexOf("(", start);
  let depth = 0;
  for (; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) break;
  }
  // Return type (if any) up to the body's "{" at angle/brace depth 0, or an arrow function's "=>".
  let angle = 0;
  let brace = 0;
  for (i++; i < code.length; i++) {
    const c = code[i];
    if (c === "<") angle++;
    else if (c === ">" && code[i - 1] !== "=") angle--;
    else if (c === "{" && angle === 0 && brace === 0) break;
    else if (c === "{") brace++;
    else if (c === "}") brace--;
    else if (c === "=" && code[i + 1] === ">" && angle === 0 && brace === 0) {
      i += 2;
      while (/\s/.test(code[i])) i++;
      if (code[i] === "{") break;
      // Expression-bodied arrow: up to the end of the statement.
      const end = code.indexOf(";\n", i);
      return code.slice(i, end === -1 ? code.length : end);
    }
  }
  const open = i;
  depth = 0;
  for (; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) return code.slice(open + 1, i);
  }
  throw new Error(`unbalanced braces at ${code.slice(start, start + 80)}`);
}

type Fn = { name: string; exported: boolean; body: string };

function functionsIn(code: string): Fn[] {
  const fns: Fn[] = [];
  const decl = /^(export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*[<(]|^(export\s+)?const\s+([A-Za-z0-9_]+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_]+)\s*(?::[^=]+)?=>/gm;
  for (const m of code.matchAll(decl)) {
    const name = m[2] ?? m[4];
    fns.push({ name, exported: Boolean(m[1] ?? m[3]), body: functionBody(code, m.index!) });
  }
  return fns;
}

/** Whether `fn` calls a member guard, itself or through a same-file helper it calls. */
function isMemberGuarded(fn: Fn, byName: Map<string, Fn>, seen = new Set<string>()): boolean {
  if (MEMBER_GUARD.test(fn.body)) return true;
  seen.add(fn.name);
  for (const [name, helper] of byName) {
    if (seen.has(name) || helper.exported) continue;
    if (new RegExp(`\\b${name}\\s*\\(`).test(fn.body) && isMemberGuarded(helper, byName, seen)) return true;
  }
  return false;
}

function actionFiles() {
  return readdirSync(ACTIONS_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
}

function exportedActions(file: string) {
  const code = stripCommentsAndStrings(readFileSync(join(ACTIONS_DIR, file), "utf8"));
  const fns = functionsIn(code);
  const byName = new Map(fns.map((f) => [f.name, f]));
  return fns.filter((f) => f.exported).map((f) => ({ ...f, memberGuarded: isMemberGuarded(f, byName) }));
}

describe("guest preview: every Server Action is member-guarded or deliberately allow-listed", () => {
  it("finds the actions (scanner sanity check)", () => {
    const all = actionFiles().flatMap((f) => exportedActions(f));
    expect(all.length).toBeGreaterThan(250);
    const toggleLike = exportedActions("likes.ts").find((f) => f.name === "toggleLike");
    expect(toggleLike?.memberGuarded).toBe(true);
  });

  it("has no unclassified export", () => {
    const problems: string[] = [];
    for (const file of actionFiles()) {
      for (const fn of exportedActions(file)) {
        const allowedRead = GUEST_READ_ALLOWED[file]?.includes(fn.name) ?? false;
        const isPublic = Boolean(PUBLIC_NO_SESSION[file]?.[fn.name]);
        const usesViewer = VIEWER_GUARD.test(fn.body);
        if (allowedRead) {
          if (!usesViewer) problems.push(`${file} ${fn.name}: allow-listed for guests but doesn't call requireViewer`);
          continue;
        }
        if (usesViewer) {
          problems.push(`${file} ${fn.name}: calls requireViewer but isn't in GUEST_READ_ALLOWED`);
          continue;
        }
        if (isPublic) {
          if (fn.memberGuarded) problems.push(`${file} ${fn.name}: listed as public but calls a member guard`);
          continue;
        }
        if (!fn.memberGuarded) problems.push(`${file} ${fn.name}: no member guard (requireUser) and not allow-listed`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("has no stale allow-list entry", () => {
    const missing: string[] = [];
    const lists = [
      ...Object.entries(GUEST_READ_ALLOWED).map(([file, names]) => [file, [...names]] as const),
      ...Object.entries(PUBLIC_NO_SESSION).map(([file, reasons]) => [file, Object.keys(reasons)] as const),
    ];
    for (const [file, names] of lists) {
      const exported = new Set(exportedActions(file).map((f) => f.name));
      for (const name of names) if (!exported.has(name)) missing.push(`${file} ${name}`);
    }
    expect(missing).toEqual([]);
  });

  it("keeps requireViewer out of everything but the listed read-only callers", () => {
    const offenders: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "generated" || entry.name === "node_modules") continue;
          walk(path);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const rel = path.slice(ROOT.length + 1).replace(/\\/g, "/");
          if (rel.startsWith("src/app/actions/")) continue;
          const code = stripCommentsAndStrings(readFileSync(path, "utf8"));
          if (VIEWER_GUARD.test(code) && !VIEWER_CALLERS.includes(rel)) offenders.push(rel);
        }
      }
    }
    walk(join(ROOT, "src"));
    expect(offenders).toEqual([]);
  });
});

describe("guest preview: members-only pages show the guest screen", () => {
  const GATED_PAGES = [
    "src/app/notifications/page.tsx",
    "src/app/messages/page.tsx",
    "src/app/messages/[id]/page.tsx",
    "src/app/messages/new/page.tsx",
    "src/app/messages/hidden/page.tsx",
    "src/app/connections/page.tsx",
    "src/app/settings/page.tsx",
    "src/app/settings/ambient/page.tsx",
    "src/app/circles/new/page.tsx",
    "src/app/collab/new/page.tsx",
    "src/app/collab/[id]/edit/page.tsx",
    "src/app/invite/page.tsx",
    "src/app/u/[userId]/page.tsx",
  ];
  it.each(GATED_PAGES)("%s", (page) => {
    const code = readFileSync(join(ROOT, page), "utf8");
    expect(code).toMatch(/isGuestPreview\)\s*(?:\{\s*if \([a-z]+\.isGuestPreview\)\s*)?return <GuestGatedScreen/);
  });
});
