import { describe, expect, it } from "vitest";
import {
  CHALLENGE_EDIT_WINDOW_MS,
  CHALLENGE_MIN_PARTICIPANTS,
  CHALLENGE_OPEN_MAX,
  CHALLENGE_PARTICIPANTS_MAX,
  CHALLENGE_SAME_WINNER_MAX,
  CHALLENGE_WINNERS_MAX,
  CHALLENGE_WIN_OCCASION_WINDOW_MS,
  cancelRefusal,
  canHostLiveChallenge,
  canRunChallenge,
  canViewerSeeChallenge,
  challengeAuditReason,
  challengeResultHref,
  challengeTextRefusal,
  challengeWinWindowStart,
  challengesEnabledFor,
  declareRefusal,
  editRefusal,
  editableUntilFor,
  farmingRefusal,
  hostAccountOldEnough,
  joinRefusal,
  normalizeChallengeText,
  openLimitRefusal,
  runsCircle,
  winnerChanges,
  withinEditWindow,
} from "@/lib/challenges";
import { giftsEnabledFor } from "@/lib/gifts";

// The pure rules of challenges (Gift Universe Phase B, src/lib/challenges.ts): the gate, who may run / declare / edit /
// cancel, the 24h lock, winner constraints, the minimum participants, the farming limit and the 72h occasion window.

const NOW = new Date("2026-11-15T12:00:00Z");
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

describe("challengesEnabledFor (the gate)", () => {
  it("is exactly the gifts gate: site admins only, never the guest identity", () => {
    const cases = [
      null,
      undefined,
      { isAdmin: false },
      { isAdmin: true },
      { isAdmin: true, isGuestPreview: true },
      { isAdmin: false, isGuestPreview: false },
    ];
    for (const user of cases) expect(challengesEnabledFor(user)).toBe(giftsEnabledFor(user));
    expect(challengesEnabledFor({ isAdmin: true })).toBe(true);
    expect(challengesEnabledFor({ isAdmin: false })).toBe(false);
  });
});

describe("text", () => {
  it("trims and collapses whitespace; empty is null", () => {
    expect(normalizeChallengeText("  Best   shot  ")).toBe("Best shot");
    expect(normalizeChallengeText("   ")).toBeNull();
    expect(normalizeChallengeText(42)).toBeNull();
  });
  it("needs a title of at most 80 characters (as the user sees them) and details of at most 280", () => {
    expect(challengeTextRefusal(null, null)).toBe("title_required");
    expect(challengeTextRefusal("a".repeat(80), null)).toBeNull();
    expect(challengeTextRefusal("a".repeat(81), null)).toBe("title_too_long");
    expect(challengeTextRefusal("🏆".repeat(80), null)).toBeNull();
    expect(challengeTextRefusal("ok", "d".repeat(281))).toBe("description_too_long");
    expect(challengeTextRefusal("ok", "d".repeat(280))).toBeNull();
  });
});

describe("who may host and run", () => {
  it("needs an account at least 7 days old", () => {
    expect(hostAccountOldEnough(new Date(NOW.getTime() - 7 * DAY), NOW)).toBe(true);
    expect(hostAccountOldEnough(new Date(NOW.getTime() - 7 * DAY + 1), NOW)).toBe(false);
    expect(hostAccountOldEnough(null, NOW)).toBe(false);
    expect(hostAccountOldEnough(new Date("nope"), NOW)).toBe(false);
  });
  it("runs a Circle: its owner or a co-admin, never a plain member (no site-admin shortcut exists here)", () => {
    expect(runsCircle({ userId: "o", circleOwnerId: "o", role: "MEMBER" })).toBe(true);
    expect(runsCircle({ userId: "m", circleOwnerId: "o", role: "MODERATOR" })).toBe(true);
    expect(runsCircle({ userId: "m", circleOwnerId: "o", role: "OWNER" })).toBe(true);
    expect(runsCircle({ userId: "m", circleOwnerId: "o", role: "MEMBER" })).toBe(false);
    expect(runsCircle({ userId: "m", circleOwnerId: "o", role: null })).toBe(false);
  });
  it("hosts on a live stream: its host only, while live", () => {
    expect(canHostLiveChallenge({ userId: "h", streamHostId: "h", streamStatus: "LIVE" })).toBe(true);
    expect(canHostLiveChallenge({ userId: "h", streamHostId: "h", streamStatus: "ENDED" })).toBe(false);
    expect(canHostLiveChallenge({ userId: "v", streamHostId: "h", streamStatus: "LIVE" })).toBe(false);
  });
  it("runs a challenge: its host while still a member, or whoever runs the Circle; a live one, the stream's host", () => {
    const circle = (runs: boolean, isMember: boolean) => ({ kind: "CIRCLE" as const, runsCircle: runs, isMember });
    expect(canRunChallenge({ userId: "h", hostId: "h", context: circle(false, true) })).toBe(true);
    expect(canRunChallenge({ userId: "h", hostId: "h", context: circle(false, false) })).toBe(false);
    expect(canRunChallenge({ userId: "a", hostId: "h", context: circle(true, true) })).toBe(true);
    expect(canRunChallenge({ userId: "x", hostId: "h", context: circle(false, true) })).toBe(false);
    expect(canRunChallenge({ userId: "h", hostId: "h", context: { kind: "LIVE", streamHostId: "h" } })).toBe(true);
    expect(canRunChallenge({ userId: "c", hostId: "h", context: { kind: "LIVE", streamHostId: "h" } })).toBe(false);
    expect(canRunChallenge({ userId: "h", hostId: null, context: { kind: "LIVE", streamHostId: "h" } })).toBe(false);
  });
  it("caps open challenges per host and per Circle / stream", () => {
    expect(openLimitRefusal(CHALLENGE_OPEN_MAX - 1, CHALLENGE_OPEN_MAX - 1)).toBeNull();
    expect(openLimitRefusal(CHALLENGE_OPEN_MAX, 0)).toBe("too_many_open");
    expect(openLimitRefusal(0, CHALLENGE_OPEN_MAX)).toBe("too_many_open");
    expect(CHALLENGE_OPEN_MAX).toBe(5);
  });
});

describe("joining", () => {
  const base = { status: "OPEN" as const, isHost: false, alreadyJoined: false, participantCount: 0, blocked: false };
  it("is open to anyone in the place, never the host, never across a block, never twice, never past the cap", () => {
    expect(joinRefusal(base)).toBeNull();
    expect(joinRefusal({ ...base, status: "DECIDED" })).toBe("not_open");
    expect(joinRefusal({ ...base, isHost: true })).toBe("host");
    expect(joinRefusal({ ...base, blocked: true })).toBe("unavailable");
    expect(joinRefusal({ ...base, alreadyJoined: true })).toBe("already_joined");
    expect(joinRefusal({ ...base, participantCount: CHALLENGE_PARTICIPANTS_MAX })).toBe("full");
  });
});

describe("declaring winners", () => {
  const base = { status: "OPEN" as const, declarerId: "h", participantIds: ["a", "b", "c"], winnerIds: ["a"] };
  it("takes 1..10 distinct winners who joined, never the declarer", () => {
    expect(declareRefusal(base)).toBeNull();
    expect(declareRefusal({ ...base, winnerIds: [] })).toBe("invalid_winners");
    expect(declareRefusal({ ...base, winnerIds: ["a", "a"] })).toBe("invalid_winners");
    const many = Array.from({ length: CHALLENGE_WINNERS_MAX + 1 }, (_, i) => `p${i}`);
    expect(declareRefusal({ ...base, participantIds: many, winnerIds: many })).toBe("invalid_winners");
    expect(declareRefusal({ ...base, participantIds: many, winnerIds: many.slice(0, 10) })).toBeNull();
    expect(declareRefusal({ ...base, winnerIds: ["z"] })).toBe("not_participant");
    expect(declareRefusal({ ...base, participantIds: ["h", "a", "b"], winnerIds: ["h"] })).toBe("self_win");
  });
  it("needs at least 2 participants besides the declarer", () => {
    expect(CHALLENGE_MIN_PARTICIPANTS).toBe(2);
    expect(declareRefusal({ ...base, participantIds: ["a"] })).toBe("too_few_participants");
    // The declarer having joined doesn't count towards the 2.
    expect(declareRefusal({ ...base, participantIds: ["h", "a"] })).toBe("too_few_participants");
    expect(declareRefusal({ ...base, participantIds: ["a", "b"] })).toBeNull();
  });
  it("only an OPEN challenge is declared; only a DECIDED one is edited", () => {
    expect(declareRefusal({ ...base, status: "DECIDED" })).toBe("not_open");
    expect(declareRefusal({ ...base, status: "CANCELLED" })).toBe("not_open");
    expect(declareRefusal({ ...base, status: "DECIDED", editing: true })).toBeNull();
    expect(declareRefusal({ ...base, status: "OPEN", editing: true })).toBe("not_open");
  });
});

describe("the 24h edit window", () => {
  const decidedAt = NOW;
  const until = editableUntilFor(decidedAt);
  it("locks 24h after the decision", () => {
    expect(until.getTime() - decidedAt.getTime()).toBe(CHALLENGE_EDIT_WINDOW_MS);
    expect(CHALLENGE_EDIT_WINDOW_MS).toBe(DAY);
    expect(withinEditWindow(until, new Date(until.getTime()))).toBe(true);
    expect(withinEditWindow(until, new Date(until.getTime() + 1))).toBe(false);
    expect(withinEditWindow(null, NOW)).toBe(false);
  });
  it("lets only the declarer change the winners, only within it", () => {
    const base = { status: "DECIDED" as const, decidedById: "h", editableUntil: until, userId: "h", now: NOW };
    expect(editRefusal(base)).toBeNull();
    expect(editRefusal({ ...base, userId: "admin" })).toBe("forbidden");
    expect(editRefusal({ ...base, now: new Date(until.getTime() + 1) })).toBe("locked");
    expect(editRefusal({ ...base, status: "OPEN" })).toBe("not_decided");
    expect(editRefusal({ ...base, status: "CANCELLED" })).toBe("not_decided");
  });
  it("cancel: OPEN by whoever runs it; DECIDED by its declarer within 24h; never twice", () => {
    const base = { canRun: true, decidedById: null, editableUntil: null, userId: "h", now: NOW };
    expect(cancelRefusal({ ...base, status: "OPEN" })).toBeNull();
    expect(cancelRefusal({ ...base, status: "OPEN", canRun: false })).toBe("forbidden");
    const decided = { ...base, status: "DECIDED" as const, decidedById: "h", editableUntil: until };
    expect(cancelRefusal(decided)).toBeNull();
    expect(cancelRefusal({ ...decided, userId: "other" })).toBe("forbidden");
    expect(cancelRefusal({ ...decided, now: new Date(until.getTime() + 1) })).toBe("locked");
    expect(cancelRefusal({ ...base, status: "CANCELLED" })).toBe("already_cancelled");
  });
});

describe("anti-farming", () => {
  it("refuses a winner this declarer already named in 3 other challenges in 7 days", () => {
    expect(CHALLENGE_SAME_WINNER_MAX).toBe(3);
    expect(farmingRefusal(new Map([["a", 2]]), ["a"])).toBeNull();
    expect(farmingRefusal(new Map([["a", 3]]), ["a", "b"])).toBe("farming");
    expect(farmingRefusal(new Map([["a", 3]]), ["b"])).toBeNull();
    expect(farmingRefusal(new Map(), ["a"])).toBeNull();
  });
  it("works out who an edit adds and removes", () => {
    expect(winnerChanges(["a", "b"], ["b", "c"])).toEqual({ added: ["c"], removed: ["a"] });
    expect(winnerChanges(["a"], ["a"])).toEqual({ added: [], removed: [] });
  });
});

describe("the CHALLENGE_WIN window (72h, one per recipient)", () => {
  const ago = (h: number) => new Date(NOW.getTime() - h * HOUR);
  it("opens at a win and lasts 72h", () => {
    expect(CHALLENGE_WIN_OCCASION_WINDOW_MS).toBe(72 * HOUR);
    expect(challengeWinWindowStart([ago(1)], NOW)).toEqual(ago(1));
    expect(challengeWinWindowStart([ago(72)], NOW)).toEqual(ago(72));
    expect(challengeWinWindowStart([ago(72.01)], NOW)).toBeNull();
    expect(challengeWinWindowStart([], NOW)).toBeNull();
  });
  it("never restarts or extends for wins inside an open window, whatever the input order", () => {
    expect(challengeWinWindowStart([ago(5), ago(60), ago(30)], NOW)).toEqual(ago(60));
    // 80h ago opened [80h, 8h ago]; a win 10h ago fell inside it, so it opened nothing: the promotion is over.
    expect(challengeWinWindowStart([ago(80), ago(10)], NOW)).toBeNull();
    // A win after the window closed (5h ago, 75h after the first) opens a new one.
    expect(challengeWinWindowStart([ago(80), ago(5)], NOW)).toEqual(ago(5));
    // 100h ago opened [100h, 28h ago]; 50h ago is inside it; nothing is open now.
    expect(challengeWinWindowStart([ago(100), ago(50)], NOW)).toBeNull();
  });
  it("ignores invalid and future dates and never throws", () => {
    expect(challengeWinWindowStart([new Date("nope"), null, undefined, ago(-1)], NOW)).toBeNull();
    expect(challengeWinWindowStart([ago(1)], new Date("nope"))).toBeNull();
  });
});

describe("who may know a challenge exists", () => {
  const base = { viewerId: "v", hostId: "h", blockedWithHost: false, circle: null, stream: null };
  it("a Circle challenge: public Circles, private ones for members only, never across a block", () => {
    expect(canViewerSeeChallenge({ ...base, circle: { visibility: "PUBLIC", viewerIsMember: false } })).toBe(true);
    expect(canViewerSeeChallenge({ ...base, circle: { visibility: "PRIVATE", viewerIsMember: false } })).toBe(false);
    expect(canViewerSeeChallenge({ ...base, circle: { visibility: "PRIVATE", viewerIsMember: true } })).toBe(true);
    expect(
      canViewerSeeChallenge({ ...base, blockedWithHost: true, circle: { visibility: "PUBLIC", viewerIsMember: true } }),
    ).toBe(false);
  });
  it("a live challenge: the stream's audience", () => {
    const stream = (over: Record<string, unknown>) => ({ hostId: "h", targetUserId: null, circle: null, ...over });
    expect(canViewerSeeChallenge({ ...base, stream: stream({}) })).toBe(true);
    expect(canViewerSeeChallenge({ ...base, stream: stream({ targetUserId: "v" }) })).toBe(true);
    expect(canViewerSeeChallenge({ ...base, stream: stream({ targetUserId: "w" }) })).toBe(false);
    expect(canViewerSeeChallenge({ ...base, stream: stream({ circle: { visibility: "PRIVATE", viewerIsMember: false } }) })).toBe(false);
    expect(canViewerSeeChallenge({ ...base, stream: stream({ circle: { visibility: "PUBLIC", viewerIsMember: false } }) })).toBe(true);
    expect(canViewerSeeChallenge(base)).toBe(false);
  });
});

describe("links and the record", () => {
  it("opens the Circle's Challenges, or the winner's Gifts for a live challenge", () => {
    expect(challengeResultHref({ circleSlug: "runners", recipientId: "me" })).toBe("/circles/runners#challenges");
    expect(challengeResultHref({ circleSlug: null, recipientId: "me" })).toBe("/u/me#gifts");
  });
  it("audits ids only: no title, nobody's name", () => {
    expect(challengeAuditReason("decided", "c1", ["a", "b"])).toBe("challenge:c1 decided winners:a,b");
    expect(challengeAuditReason("edited", "c1", ["b", "c"], { added: ["c"], removed: ["a"] })).toBe(
      "challenge:c1 edited winners:b,c added:c removed:a",
    );
    expect(challengeAuditReason("cancelled", "c1", [])).toBe("challenge:c1 cancelled winners:-");
  });
});
