import { describe, expect, it } from "vitest";
import {
  activeLiveStreamsWhere,
  addsToSelectedAudience,
  audienceForInvitees,
  isSelectedViewer,
  LIVE_SELECTED_AUDIENCE_MAX,
  parseNotInvited,
  selectedInviteGoneNotice,
  SELECTED_AUDIENCE_VALUE,
  selectedAudienceInviteWhere,
} from "./live-audience";
import { LIVE_INVITE_MAX_PER_REQUEST } from "./live-stage";
import { MAX_LIVE_VIEWERS } from "./live-viewer-cap";

describe("audienceForInvitees (the Go live sheet's default)", () => {
  it("picking the first person switches Everyone to 'Only the people I selected'", () => {
    expect(audienceForInvitees({ audience: "", count: 1, keepEveryone: false })).toBe(SELECTED_AUDIENCE_VALUE);
    expect(audienceForInvitees({ audience: "", count: 4, keepEveryone: false })).toBe(SELECTED_AUDIENCE_VALUE);
  });

  it("clearing every pick goes back to Everyone", () => {
    expect(audienceForInvitees({ audience: SELECTED_AUDIENCE_VALUE, count: 0, keepEveryone: false })).toBe("");
    expect(audienceForInvitees({ audience: SELECTED_AUDIENCE_VALUE, count: 0, keepEveryone: true })).toBe("");
  });

  it("Everyone chosen on purpose while people are picked is kept", () => {
    expect(audienceForInvitees({ audience: "", count: 2, keepEveryone: true })).toBe("");
  });

  it("a Circle or one person is never changed by picking or clearing", () => {
    for (const audience of ["circle:c1", "user:u1"]) {
      expect(audienceForInvitees({ audience, count: 3, keepEveryone: false })).toBe(audience);
      expect(audienceForInvitees({ audience, count: 0, keepEveryone: false })).toBe(audience);
    }
  });

  it("nobody picked and Everyone stays Everyone", () => {
    expect(audienceForInvitees({ audience: "", count: 0, keepEveryone: false })).toBe("");
  });
});

describe("isSelectedViewer / addsToSelectedAudience", () => {
  it("an invite not cancelled, or a stage seat, lets someone watch", () => {
    for (const s of ["PENDING", "ACCEPTED", "DECLINED", "EXPIRED"] as const) {
      expect(isSelectedViewer({ inviteStatus: s, stageRole: null })).toBe(true);
    }
    expect(isSelectedViewer({ inviteStatus: "CANCELLED", stageRole: null })).toBe(false);
    expect(isSelectedViewer({ inviteStatus: null, stageRole: null })).toBe(false);
    expect(isSelectedViewer({ inviteStatus: null, stageRole: "VIEWER" })).toBe(false);
    expect(isSelectedViewer({ inviteStatus: "CANCELLED", stageRole: "GUEST" })).toBe(true);
    expect(isSelectedViewer({ inviteStatus: null, stageRole: "COHOST" })).toBe(true);
  });

  it("only a new person or a cancelled one counts toward the allow-list cap", () => {
    expect(addsToSelectedAudience(undefined)).toBe(true);
    expect(addsToSelectedAudience(null)).toBe(true);
    expect(addsToSelectedAudience("CANCELLED")).toBe(true);
    for (const s of ["PENDING", "ACCEPTED", "DECLINED", "EXPIRED"] as const) expect(addsToSelectedAudience(s)).toBe(false);
    expect(selectedAudienceInviteWhere("s1")).toEqual({ liveStreamId: "s1", status: { not: "CANCELLED" } });
  });

  it("the allow-list cap covers a full start and leaves room to invite more, within the viewer cap", () => {
    expect(LIVE_SELECTED_AUDIENCE_MAX).toBeGreaterThan(LIVE_INVITE_MAX_PER_REQUEST);
    expect(LIVE_SELECTED_AUDIENCE_MAX).toBeLessThanOrEqual(MAX_LIVE_VIEWERS);
  });
});

// ---------- The Home strip query, evaluated against in-memory streams ----------

type Invite = { inviteeId: string; status: string };
type Seat = { userId: string; role: string };
type Stream = {
  id: string;
  status: "LIVE" | "ENDED";
  roomName: string;
  hostId: string;
  circleId: string | null;
  targetUserId: string | null;
  selectedOnly: boolean;
  circle: { visibility: "PUBLIC" | "PRIVATE" } | null;
  stageInvites: Invite[];
  viewers: Seat[];
};

/** A small evaluator for exactly the Prisma `where` shapes activeLiveStreamsWhere builds. */
function test(value: unknown, cond: unknown): boolean {
  if (cond === null || typeof cond !== "object") return value === cond;
  const c = cond as Record<string, unknown>;
  if ("not" in c) return !test(value, c.not);
  if ("notIn" in c) return !(c.notIn as unknown[]).includes(value);
  if ("in" in c) return (c.in as unknown[]).includes(value);
  if ("some" in c) return (value as unknown[]).some((item) => matches(item as Record<string, unknown>, c.some as Record<string, unknown>));
  return matches(value as Record<string, unknown>, c);
}
function matches(row: Record<string, unknown> | null, where: Record<string, unknown>): boolean {
  if (row === null) return false;
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return (cond as Record<string, unknown>[]).some((w) => matches(row, w));
    if (key === "AND") return (cond as Record<string, unknown>[]).every((w) => matches(row, w));
    return test(row[key], cond);
  });
}

function stream(over: Partial<Stream>): Stream {
  return {
    id: "s",
    status: "LIVE",
    roomName: "live-s",
    hostId: "host",
    circleId: null,
    targetUserId: null,
    selectedOnly: false,
    circle: null,
    stageInvites: [],
    viewers: [],
    ...over,
  };
}

function listedFor(userId: string, streams: Stream[], blocked: string[] = []) {
  const where = activeLiveStreamsWhere(userId, blocked);
  return streams.filter((s) => matches(s as unknown as Record<string, unknown>, where)).map((s) => s.id);
}

describe("activeLiveStreamsWhere (Home's Live now strip)", () => {
  const selected = stream({
    id: "selected",
    selectedOnly: true,
    stageInvites: [
      { inviteeId: "picked", status: "PENDING" },
      { inviteeId: "declined", status: "DECLINED" },
      { inviteeId: "cancelled", status: "CANCELLED" },
      { inviteeId: "cancelledOnStage", status: "CANCELLED" },
    ],
    viewers: [
      { userId: "cancelledOnStage", role: "GUEST" },
      { userId: "watcher", role: "VIEWER" },
      { userId: "cohost", role: "COHOST" },
    ],
  });
  const everyone = stream({ id: "everyone" });
  const publicCircle = stream({ id: "public", circleId: "c1", circle: { visibility: "PUBLIC" } });
  const privateCircle = stream({ id: "private", circleId: "c2", circle: { visibility: "PRIVATE" } });
  const person = stream({ id: "person", targetUserId: "picked" });
  const ended = stream({ id: "ended", status: "ENDED", selectedOnly: true, stageInvites: [{ inviteeId: "picked", status: "PENDING" }] });
  const attaching = stream({ id: "attaching", roomName: "", selectedOnly: true, stageInvites: [{ inviteeId: "picked", status: "PENDING" }] });
  const all = [selected, everyone, publicCircle, privateCircle, person, ended, attaching];

  it("a picked person sees the selected live alongside the public ones (never a private Circle's or a person's)", () => {
    expect(listedFor("picked", all)).toEqual(["selected", "everyone", "public"]);
    expect(listedFor("declined", all)).toEqual(["selected", "everyone", "public"]);
  });

  it("anyone not picked sees only the public ones", () => {
    expect(listedFor("stranger", all)).toEqual(["everyone", "public"]);
    // A plain viewer row (someone who got in earlier) is not a place on the list.
    expect(listedFor("watcher", all)).toEqual(["everyone", "public"]);
  });

  it("a cancelled invite takes the live off their Home, unless they are on stage", () => {
    expect(listedFor("cancelled", all)).toEqual(["everyone", "public"]);
    expect(listedFor("cancelledOnStage", all)).toEqual(["selected", "everyone", "public"]);
    expect(listedFor("cohost", all)).toEqual(["selected", "everyone", "public"]);
  });

  it("the host sees their own selected live", () => {
    expect(listedFor("host", all)).toEqual(["selected", "everyone", "public"]);
  });

  it("a block either way with the host hides it from a picked person", () => {
    expect(listedFor("picked", all, ["host"])).toEqual(["everyone", "public"]);
  });

  it("existing audiences are unchanged: Everyone and PUBLIC Circles for all, never private Circles or one person", () => {
    expect(listedFor("anyone", [everyone, publicCircle, privateCircle, person])).toEqual(["everyone", "public"]);
  });
});

describe("selectedInviteGoneNotice (a stale invite to a selected-only live)", () => {
  const base = { selectedOnly: true, inviteStatus: "CANCELLED" as const, streamLive: true, blocked: false };
  it("a cancelled invitee gets the 'cancelled' note while it is live, 'ended' after", () => {
    expect(selectedInviteGoneNotice(base)).toBe("cancelled");
    expect(selectedInviteGoneNotice({ ...base, streamLive: false })).toBe("ended");
    expect(selectedInviteGoneNotice({ ...base, inviteStatus: "EXPIRED" })).toBe("expired");
  });
  it("no invite row, a block, or another audience: no note (the normal 404)", () => {
    expect(selectedInviteGoneNotice({ ...base, inviteStatus: null })).toBeNull();
    expect(selectedInviteGoneNotice({ ...base, blocked: true })).toBeNull();
    expect(selectedInviteGoneNotice({ ...base, selectedOnly: false })).toBeNull();
  });
});

describe("parseNotInvited", () => {
  it("takes a small whole count and nothing else", () => {
    expect(parseNotInvited("2")).toBe(2);
    expect(parseNotInvited(String(LIVE_INVITE_MAX_PER_REQUEST))).toBe(LIVE_INVITE_MAX_PER_REQUEST);
    for (const raw of [undefined, "", "0", "-1", "1.5", "abc", String(LIVE_INVITE_MAX_PER_REQUEST + 1)]) {
      expect(parseNotInvited(raw)).toBe(0);
    }
  });
});