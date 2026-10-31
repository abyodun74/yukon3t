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
};

const me = { id: "callee", name: "Bo" };
let callRow: CallRow;
let users: Record<string, { name: string | null }>;
let hiddenPeers: string[];

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
vi.mock("@/lib/fcm", () => ({ sendFcmCallToUser: vi.fn() }));
vi.mock("@/lib/apns-voip", () => ({ sendVoipCallToUser: vi.fn(), sendVoipCallCancelToUser: vi.fn() }));
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

const { respondToCall } = await import("@/app/actions/calls");

beforeEach(() => {
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
  };
  users = { caller: { name: "Ana" } };
  hiddenPeers = [];
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
