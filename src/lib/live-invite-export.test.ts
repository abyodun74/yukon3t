import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_INVITE_TTL_MS } from "@/lib/live-stage";

// The "Live stage invites" part of "Export my data": sent and received, the other person named only by display name
// and username while ACTIVE and not blocked either way / a hidden peer, nothing else of theirs, invites to or from a
// hidden peer left out, status as the app reads it, and each list capped.
const ME = "me";
const SECRETS = { email: "leak@example.com", phone: "+15550100", birthDate: new Date("1990-01-01"), passwordHash: "x" };
const person = (id: string, status = "ACTIVE") => ({ id, name: `Name ${id}`, username: `${id}_u`, status, ...SECRETS });

let blocks: { blockerId: string; blockedId: string }[] = [];
let sent: unknown[] = [];
let received: unknown[] = [];
const calls: { where: Record<string, unknown>; select: Record<string, unknown>; take: number }[] = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    block: { findMany: async () => blocks },
    liveStreamInvite: {
      findMany: async (args: { where: Record<string, unknown>; select: Record<string, unknown>; take: number }) => {
        calls.push(args);
        return ("invitedById" in args.where ? sent : received).slice(0, args.take);
      },
    },
  },
}));

const { loadLiveInviteExport, LIVE_INVITE_EXPORT_LIMIT } = await import("@/lib/live-invite-export");

const row = (other: ReturnType<typeof person>, key: "invitee" | "invitedBy", extra: Record<string, unknown> = {}) => ({
  liveStreamId: "s1",
  status: "ACCEPTED",
  sendCount: 1,
  createdAt: new Date(),
  respondedAt: new Date(),
  liveStream: { startedAt: new Date("2026-11-17T10:00:00Z"), status: "LIVE", title: "secret title", ...SECRETS },
  [key]: other,
  ...extra,
});

beforeEach(() => {
  blocks = [];
  sent = [];
  received = [];
  calls.length = 0;
});

describe("loadLiveInviteExport", () => {
  it("lists sent and received invites with the other person's public name only", async () => {
    sent = [row(person("amy"), "invitee")];
    received = [row(person("ben"), "invitedBy", { status: "DECLINED" })];
    const out = await loadLiveInviteExport(ME, { conversationIds: [], peerIds: [] });
    expect(out.sent.items).toEqual([
      expect.objectContaining({ invited: { name: "Name amy", username: "amy_u" }, status: "ACCEPTED", timesSent: 1 }),
    ]);
    expect(out.received.items[0]).toMatchObject({ invitedBy: { name: "Name ben", username: "ben_u" }, status: "DECLINED" });
    const text = JSON.stringify(out);
    for (const secret of ["leak@example.com", "+15550100", "secret title", "passwordHash"]) expect(text).not.toContain(secret);
    expect(out.sent.items[0]!.liveStream).toEqual({ id: "s1", startedAt: new Date("2026-11-17T10:00:00Z") });
    // Exact selects: the person is asked for id, name, username and status only.
    expect(calls[0]!.select.invitee).toEqual({ select: { id: true, name: true, username: true, status: true } });
  });

  it("never names someone blocked either way or no longer active", async () => {
    blocks = [{ blockerId: "amy", blockedId: ME }];
    sent = [row(person("amy"), "invitee"), row(person("cara", "DEACTIVATED"), "invitee")];
    const out = await loadLiveInviteExport(ME, { conversationIds: [], peerIds: [] });
    expect(out.sent.items.map((i) => i.invited)).toEqual(["not_shown", "not_shown"]);
  });

  it("leaves invites to or from a hidden peer out of both queries", async () => {
    await loadLiveInviteExport(ME, { conversationIds: [], peerIds: ["hp"] });
    expect(calls[0]!.where).toEqual({ invitedById: ME, inviteeId: { notIn: ["hp"] } });
    expect(calls[1]!.where).toEqual({ inviteeId: ME, invitedById: { notIn: ["hp"] } });
  });

  it("reads an unanswered invite past its time, or on an ended live, as expired", async () => {
    sent = [
      row(person("amy"), "invitee", { status: "PENDING", createdAt: new Date(Date.now() - LIVE_INVITE_TTL_MS - 1000) }),
      row(person("ben"), "invitee", { status: "PENDING", liveStream: { startedAt: new Date(), status: "ENDED" } }),
    ];
    const out = await loadLiveInviteExport(ME, { conversationIds: [], peerIds: [] });
    expect(out.sent.items.map((i) => i.status)).toEqual(["EXPIRED", "EXPIRED"]);
  });

  it("caps each list and says so", async () => {
    sent = Array.from({ length: LIVE_INVITE_EXPORT_LIMIT + 3 }, () => row(person("amy"), "invitee"));
    const out = await loadLiveInviteExport(ME, { conversationIds: [], peerIds: [] });
    expect(out.sent.items).toHaveLength(LIVE_INVITE_EXPORT_LIMIT);
    expect(out.sent.truncated).toBe(true);
    expect(out.received.truncated).toBe(false);
  });
});
