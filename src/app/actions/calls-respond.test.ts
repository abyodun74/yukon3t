import { beforeEach, describe, expect, it, vi } from "vitest";
import { HIDDEN_CALLER_NAME } from "@/lib/hidden-chats-rules";

// respondToCall's 1:1 accept against an in-memory call row: it names the caller for the in-call screen, masked
// exactly like the ring, because an Accept from the notification or CallKit can come before the in-app ring loaded.

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
};

const me = { id: "callee", name: "Bo" };
const phoneA = { id: "tA", token: "token-a" };
const phoneB = { id: "tB", token: "token-b" };
let callRow: CallRow;
let users: Record<string, { name: string | null }>;
let hiddenPeers: string[];
let voipTokens: { id: string; token: string }[];

vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => me }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/daily", () => ({
  createCallRoom: vi.fn(),
  createMeetingToken: async () => "minted-token",
  deleteCallRoom: vi.fn(),
  isCallingConfigured: () => true,
}));
vi.mock("@/lib/blocks", () => ({ isBlockedEitherWay: async () => false, isBlockedWithAny: async () => false }));
vi.mock("@/lib/push", () => ({ sendPushToUser: vi.fn() }));
vi.mock("@/lib/fcm", () => ({ sendFcmCallToUser: vi.fn(), sendFcmCallCancelToUser: vi.fn(async () => {}) }));
vi.mock("@/lib/apns-voip", () => ({
  sendVoipCallToUser: vi.fn(),
  findVoipTokens: vi.fn(async () => voipTokens),
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
vi.mock("@/lib/hidden-chats", () => ({
  maskHiddenCallerName: async (recipientId: string, callerId: string, name: string | null) =>
    recipientId === me.id && hiddenPeers.includes(callerId) ? HIDDEN_CALLER_NAME : name,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    call: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === callRow.id ? { ...callRow } : null),
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Partial<CallRow> }) => {
        if (where.id !== callRow.id || where.status !== callRow.status) return { count: 0 };
        callRow = { ...callRow, ...data };
        return { count: 1 };
      },
    },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => users[where.id] ?? null,
    },
  },
}));

const { respondToCall, endCall } = await import("@/app/actions/calls");
const { sendFcmCallCancelToUser } = await import("@/lib/fcm");
const { sendVoipCallCancelToTokens, sendVoipCallEndedToUser } = await import("@/lib/apns-voip");
const { publishEvent } = await import("@/lib/realtime-server");

beforeEach(() => {
  vi.clearAllMocks();
  callRow = {
    id: "call1",
    callerId: "caller",
    calleeId: me.id,
    status: "RINGING",
    roomUrl: "https://example.daily.co/room",
    roomName: "room",
    calleeToken: "callee-token",
    type: "VIDEO",
    participants: [],
    voipOthersCleared: false,
    answerVoipTokenId: null,
  };
  users = { caller: { name: "Ana" } };
  hiddenPeers = [];
  voipTokens = [phoneA, phoneB];
});

describe("respondToCall (1:1 accept)", () => {
  it("returns the caller's name for the in-call screen", async () => {
    const result = await respondToCall("call1", true);
    expect(result).toMatchObject({ error: null, accepted: true, callerName: "Ana", token: "callee-token" });
    expect(callRow.status).toBe("ACCEPTED");
  });

  it("returns the Private call stand-in, never the name, for a caller whose chat the callee has hidden", async () => {
    hiddenPeers = ["caller"];
    const result = await respondToCall("call1", true);
    expect(result).toMatchObject({ error: null, accepted: true, callerName: HIDDEN_CALLER_NAME });
    expect(JSON.stringify(result)).not.toContain("Ana");
  });

  it("returns null for a caller with no name", async () => {
    users = { caller: { name: null } };
    const result = await respondToCall("call1", true);
    expect(result).toMatchObject({ error: null, accepted: true, callerName: null });
  });

  it("names nobody on a decline", async () => {
    const result = await respondToCall("call1", false);
    expect(result).toEqual({ error: null, accepted: false });
  });
});

describe("respondToCall clears the ring on the responder's other devices", () => {
  it.each([true, false])("accept=%s: Android cancel and a signal to the responder", async (accept) => {
    await respondToCall("call1", accept);
    expect(sendFcmCallCancelToUser).toHaveBeenCalledWith(me.id, "call1");
    expect(publishEvent).toHaveBeenCalledWith(`call:${me.id}`, "changed");
    expect(publishEvent).toHaveBeenCalledWith("call:caller", "changed");
  });

  it("an answer from an iPhone cancels CallKit on the other iPhones only, and is stored with the call", async () => {
    await respondToCall("call1", true, { platform: "ios", voipToken: "token-a", callKitEnded: false });
    expect(sendVoipCallCancelToTokens).toHaveBeenCalledWith([phoneB], "call1", "answeredElsewhere");
    expect(callRow).toMatchObject({ status: "ACCEPTED", voipOthersCleared: true, answerVoipTokenId: "tA" });
  });

  it("a decline from an iPhone cancels the others as declined elsewhere", async () => {
    await respondToCall("call1", false, { platform: "ios", voipToken: "token-b", callKitEnded: false });
    expect(sendVoipCallCancelToTokens).toHaveBeenCalledWith([phoneA], "call1", "declinedElsewhere");
    expect(callRow.status).toBe("DECLINED");
  });

  it("an answer from Android or a browser cancels every iPhone", async () => {
    await respondToCall("call1", true, { platform: "other" });
    expect(sendVoipCallCancelToTokens).toHaveBeenCalledWith([phoneA, phoneB], "call1", "answeredElsewhere");
    expect(callRow).toMatchObject({ voipOthersCleared: true, answerVoipTokenId: null });
  });

  it.each([
    ["no device (an older page)", undefined],
    ["an iPhone that doesn't know its token", { platform: "ios" as const, voipToken: null, callKitEnded: false }],
    ["someone else's token", { platform: "ios" as const, voipToken: "not-mine", callKitEnded: false }],
    ["a malformed device", { platform: "windows" } as never],
  ])("%s: no iPhone is sent a cancel, nothing is stored", async (_label, device) => {
    await respondToCall("call1", true, device);
    expect(sendVoipCallCancelToTokens).toHaveBeenCalledWith([], "call1", "answeredElsewhere");
    expect(callRow).toMatchObject({ status: "ACCEPTED", voipOthersCleared: false, answerVoipTokenId: null });
  });

  it("sends nothing when the ring was already resolved", async () => {
    callRow.status = "MISSED";
    expect(await respondToCall("call1", true, { platform: "other" })).toEqual({ error: "invalid" });
    expect(sendFcmCallCancelToUser).not.toHaveBeenCalled();
    expect(sendVoipCallCancelToTokens).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
    expect(callRow.voipOthersCleared).toBe(false);
  });
});

describe("endCall ends CallKit's call on the callee's answering iPhone", () => {
  beforeEach(() => {
    callRow.status = "ACCEPTED";
    callRow.voipOthersCleared = true;
    callRow.answerVoipTokenId = "tA";
  });

  it("passes the stored answer, so only the iPhone that answered is sent the cancel", async () => {
    await endCall("call1");
    expect(callRow.status).toBe("ENDED");
    expect(sendVoipCallEndedToUser).toHaveBeenCalledWith(
      me.id,
      "call1",
      { voipOthersCleared: true, answerVoipTokenId: "tA" },
      null,
    );
  });

  it("leaves out the callee's iPhone whose CallKit End made the hang-up", async () => {
    await endCall("call1", { platform: "ios", voipToken: "token-a", callKitEnded: true });
    expect(sendVoipCallEndedToUser).toHaveBeenCalledWith(me.id, "call1", expect.anything(), "token-a");
  });

  it("an in-app hang-up names no device: the answering iPhone still gets its cancel", async () => {
    await endCall("call1", { platform: "ios", voipToken: "token-a", callKitEnded: false });
    expect(sendVoipCallEndedToUser).toHaveBeenCalledWith(me.id, "call1", expect.anything(), null);
  });

  it("sends nothing for a call already over", async () => {
    callRow.status = "ENDED";
    await endCall("call1", { platform: "ios", voipToken: "token-a", callKitEnded: true });
    expect(sendVoipCallEndedToUser).not.toHaveBeenCalled();
  });
});
