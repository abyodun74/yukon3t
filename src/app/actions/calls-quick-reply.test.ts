import { beforeEach, describe, expect, it, vi } from "vitest";

// declineCallWithReply against an in-memory call row: only the callee of a ringing 1:1 call, rate limited, blocks and
// the connection re-checked, one reply per call, and nothing sent once the call was answered, cancelled or timed out.

type CallRow = {
  id: string;
  callerId: string;
  calleeId: string;
  status: string;
  roomUrl: string;
  roomName: string;
  calleeToken: string | null;
  type: "AUDIO" | "VIDEO";
  participants: unknown[];
  voipOthersCleared: boolean;
  answerVoipTokenId: string | null;
  declineReply: string | null;
  respondedAt?: Date;
};

let me = { id: "callee", name: "Bo" };
let callRow: CallRow;
let callerRow: { id: string; status: string; openToIntents: string[] } | null;
let connected: boolean;
let blocked: boolean;
let limited: Set<string>;
let destination: { error: null; conversationId: string | null } | { error: "hidden_locked" | "unavailable" };
// Runs inside the guarded write, to stage a race (the caller cancelling, the timeout, another device).
let beforeWrite: (() => void) | null;

vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => me }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async (name: string) => !limited.has(name)) }));
vi.mock("@/lib/daily", () => ({
  createCallRoom: vi.fn(),
  createMeetingToken: async () => "minted-token",
  deleteCallRoom: vi.fn(),
  isCallingConfigured: () => true,
}));
vi.mock("@/lib/blocks", () => ({ isBlockedEitherWay: async () => blocked, isBlockedWithAny: async () => false }));
vi.mock("@/lib/push", () => ({ sendPushToUser: vi.fn() }));
vi.mock("@/lib/fcm", () => ({ sendFcmCallToUser: vi.fn(), sendFcmCallCancelToUser: vi.fn(async () => {}) }));
vi.mock("@/lib/apns-voip", () => ({
  sendVoipCallToUser: vi.fn(),
  findVoipTokens: vi.fn(async () => [{ id: "tA", token: "token-a" }, { id: "tB", token: "token-b" }]),
  sendVoipCallCancelToTokens: vi.fn(async () => {}),
  sendVoipCallEndedToUser: vi.fn(async () => {}),
}));
vi.mock("@/lib/missed-call", () => ({ notifyMissedCall: vi.fn() }));
vi.mock("@/lib/call-captions-server", () => ({ stopCaptionsForCall: vi.fn() }));
vi.mock("@/lib/call-avatar-server", () => ({ nativeRingCallerAvatarUrl: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/realtime-server", () => ({ publishEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/call-participants", () => ({
  isLiveParticipantStatus: () => true,
  lockConnectedCall: vi.fn(),
  settleCall: vi.fn(),
  signalCallUsers: vi.fn(),
  wasRungForCall: () => false,
}));
vi.mock("@/lib/hidden-chats", () => ({ maskHiddenCallerName: async (_r: string, _c: string, name: string | null) => name }));
vi.mock("@/lib/i18n/server", async () => {
  const { callsEn } = await import("@/lib/i18n/en/calls");
  return { getDictionary: async () => ({ calls: callsEn }) };
});
vi.mock("@/lib/call-quick-reply-server", () => ({
  callReplyConversation: vi.fn(async () => destination),
  deliverCallReply: vi.fn(async () => true),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    call: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === callRow.id ? { ...callRow } : null),
      updateMany: async ({ where, data }: { where: Partial<CallRow>; data: Partial<CallRow> }) => {
        beforeWrite?.();
        const matches = Object.entries(where).every(([key, value]) => callRow[key as keyof CallRow] === value);
        if (!matches) return { count: 0 };
        callRow = { ...callRow, ...data };
        return { count: 1 };
      },
    },
    user: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === callerRow?.id ? callerRow : null) },
    connection: { findFirst: async () => (connected ? { id: "conn" } : null) },
  },
}));

const { declineCallWithReply, getCallStatus } = await import("@/app/actions/calls");
const { deliverCallReply, callReplyConversation } = await import("@/lib/call-quick-reply-server");
const { sendFcmCallCancelToUser } = await import("@/lib/fcm");
const { sendVoipCallCancelToTokens } = await import("@/lib/apns-voip");
const { publishEvent } = await import("@/lib/realtime-server");

const preset = (callId = "call1") => ({ callId, reply: { kind: "preset", presetId: "meeting" } });

beforeEach(() => {
  vi.clearAllMocks();
  me = { id: "callee", name: "Bo" };
  callRow = {
    id: "call1",
    callerId: "caller",
    calleeId: "callee",
    status: "RINGING",
    roomUrl: "https://example.daily.co/room",
    roomName: "room",
    calleeToken: "callee-token",
    type: "AUDIO",
    participants: [],
    voipOthersCleared: false,
    answerVoipTokenId: null,
    declineReply: null,
  };
  callerRow = { id: "caller", status: "ACTIVE", openToIntents: ["FRIENDSHIP"] };
  connected = true;
  blocked = false;
  limited = new Set();
  destination = { error: null, conversationId: "conv1" };
  beforeWrite = null;
});

function expectNothingSent() {
  expect(deliverCallReply).not.toHaveBeenCalled();
  expect(sendFcmCallCancelToUser).not.toHaveBeenCalled();
  expect(publishEvent).not.toHaveBeenCalled();
}

describe("declineCallWithReply", () => {
  it("declines the ringing call with the reply in the same write and sends it as a chat message", async () => {
    expect(await declineCallWithReply(preset())).toEqual({ error: null });
    expect(callRow).toMatchObject({ status: "DECLINED", declineReply: "I'm in a meeting." });
    expect(deliverCallReply).toHaveBeenCalledWith({
      callee: { id: "callee", name: "Bo" },
      caller: callerRow,
      callId: "call1",
      content: "I'm in a meeting.",
      conversationId: "conv1",
    });
  });

  it("stops the ring everywhere exactly like Decline and signals the caller", async () => {
    await declineCallWithReply(preset(), { platform: "ios", voipToken: "token-a", callKitEnded: false });
    expect(sendFcmCallCancelToUser).toHaveBeenCalledWith("callee", "call1");
    expect(sendVoipCallCancelToTokens).toHaveBeenCalledWith([{ id: "tB", token: "token-b" }], "call1", "declinedElsewhere");
    expect(publishEvent).toHaveBeenCalledWith("call:caller", "changed");
    expect(publishEvent).toHaveBeenCalledWith("call:callee", "changed");
  });

  it("sends cleaned-up custom text, and refuses it when nothing is left or it is too long", async () => {
    expect(await declineCallWithReply({ callId: "call1", reply: { kind: "custom", text: " running\nlate " } })).toEqual({
      error: null,
    });
    expect(callRow.declineReply).toBe("running late");

    callRow = { ...callRow, status: "RINGING", declineReply: null };
    vi.clearAllMocks();
    expect(await declineCallWithReply({ callId: "call1", reply: { kind: "custom", text: "‮ \n" } })).toEqual({
      error: "invalid",
    });
    expect(await declineCallWithReply({ callId: "call1", reply: { kind: "custom", text: "x".repeat(121) } })).toEqual({
      error: "invalid",
    });
    expect(callRow.status).toBe("RINGING");
    expectNothingSent();
  });

  it.each([
    ["an unknown preset", { callId: "call1", reply: { kind: "preset", presetId: "whatever" } }],
    ["free text passed as a preset", { callId: "call1", reply: { kind: "preset", presetId: "I'm busy" } }],
    ["a bad call id", { callId: "../x", reply: { kind: "preset", presetId: "meeting" } }],
    ["nothing", undefined],
  ])("rejects %s", async (_label, input) => {
    expect(await declineCallWithReply(input)).toEqual({ error: "invalid" });
    expect(callRow.status).toBe("RINGING");
    expectNothingSent();
  });

  it("refuses anyone but the callee, without revealing the call", async () => {
    me = { id: "caller", name: "Ana" };
    expect(await declineCallWithReply(preset())).toEqual({ error: "not_found" });
    me = { id: "stranger", name: "Eve" };
    expect(await declineCallWithReply(preset())).toEqual({ error: "not_found" });
    expect(await declineCallWithReply(preset("missing"))).toEqual({ error: "not_found" });
    expect(callRow.status).toBe("RINGING");
    expectNothingSent();
  });

  it("refuses a ring into a call people were added to", async () => {
    callRow.participants = [{ userId: "callee", status: "RINGING" }];
    expect(await declineCallWithReply(preset())).toEqual({ error: "not_found" });
    expectNothingSent();
  });

  it.each(["callQuickReply", "messageSend"])("is rate limited (%s) before anything is read or sent", async (name) => {
    limited.add(name);
    expect(await declineCallWithReply(preset())).toEqual({ error: "rate_limited" });
    expect(callRow.status).toBe("RINGING");
    expectNothingSent();
  });

  it.each([
    ["blocked either way", () => (blocked = true)],
    ["no longer connected", () => (connected = false)],
    ["the caller's account is not active", () => (callerRow = { ...callerRow!, status: "SUSPENDED" })],
    ["the caller is gone", () => (callerRow = null)],
  ])("declines nothing when %s", async (_label, arrange) => {
    arrange();
    expect(await declineCallWithReply(preset())).toEqual({ error: "unavailable" });
    expect(callRow.status).toBe("RINGING");
    expectNothingSent();
  });

  it("declines nothing when the chat it would go into is hidden and locked", async () => {
    destination = { error: "hidden_locked" };
    expect(await declineCallWithReply(preset())).toEqual({ error: "hidden_locked" });
    expect(callRow.status).toBe("RINGING");
    expect(callReplyConversation).toHaveBeenCalledWith("callee", "caller");
    expectNothingSent();
  });

  it.each(["ACCEPTED", "MISSED", "ENDED"])("sends nothing for a call already %s", async (status) => {
    callRow.status = status;
    expect(await declineCallWithReply(preset())).toEqual({ error: "not_ringing" });
    expect(callRow.declineReply).toBeNull();
    expectNothingSent();
  });

  it("sends nothing after a plain decline", async () => {
    callRow.status = "DECLINED";
    expect(await declineCallWithReply(preset())).toEqual({ error: "not_ringing" });
    expectNothingSent();
  });

  it.each([
    ["answered on another device", "ACCEPTED"],
    ["cancelled by the caller", "MISSED"],
    ["timed out", "MISSED"],
  ])("loses the race cleanly when the call is %s between the checks and the write", async (_label, status) => {
    beforeWrite = () => {
      callRow.status = status;
    };
    expect(await declineCallWithReply(preset())).toEqual({ error: "not_ringing" });
    expect(callRow.status).toBe(status);
    expect(callRow.declineReply).toBeNull();
    expectNothingSent();
  });

  it("is idempotent: a repeat answers success and sends no second message", async () => {
    expect(await declineCallWithReply(preset())).toEqual({ error: null });
    expect(await declineCallWithReply({ callId: "call1", reply: { kind: "preset", presetId: "driving" } })).toEqual({
      error: null,
    });
    expect(deliverCallReply).toHaveBeenCalledTimes(1);
    expect(callRow.declineReply).toBe("I'm in a meeting.");
  });

  it("a second reply racing the first one answers success without sending", async () => {
    beforeWrite = () => {
      callRow.status = "DECLINED";
      callRow.declineReply = "On my way.";
    };
    expect(await declineCallWithReply(preset())).toEqual({ error: null });
    expect(callRow.declineReply).toBe("On my way.");
    expectNothingSent();
  });
});

describe("getCallStatus shows the reply to the caller only", () => {
  beforeEach(() => {
    callRow.status = "DECLINED";
    callRow.declineReply = "I'm driving.";
  });

  it("the caller gets the reply", async () => {
    me = { id: "caller", name: "Ana" };
    expect(await getCallStatus("call1")).toMatchObject({ status: "DECLINED", reply: "I'm driving." });
  });

  it("the callee and strangers don't", async () => {
    expect(await getCallStatus("call1")).toMatchObject({ status: "DECLINED", reply: null });
    me = { id: "stranger", name: "Eve" };
    expect(await getCallStatus("call1")).toEqual({ error: "not_found" });
  });
});
