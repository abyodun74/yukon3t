import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

// The chat half of a quick reply: where it goes (a locked hidden chat refuses before anything is declined) and the
// one message per call it becomes.

let existingConversation: string | null;
let membership: { hiddenAt: Date | null } | null;
let locked: boolean;
let insert: () => Promise<{ error: null; id: string } | { error: "secret_chat" }>;

vi.mock("@/lib/direct-conversation", () => ({
  findDirectConversationId: vi.fn(async () => existingConversation),
  startDirectConversation: vi.fn(async () => "new-conv"),
}));
vi.mock("@/lib/hidden-chats", () => ({ isMembershipLocked: vi.fn(async () => locked) }));
vi.mock("@/lib/non-e2ee-message", () => ({ createNonE2eeMessage: vi.fn(async () => insert()) }));
vi.mock("@/lib/after-message-sent", () => ({ afterMessageSent: vi.fn(async () => {}) }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn(async () => {}) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversationMember: { findUnique: vi.fn(async () => membership) },
    call: { update: vi.fn(async () => ({})) },
  },
}));

const { callReplyConversation, deliverCallReply } = await import("@/lib/call-quick-reply-server");
const { createNonE2eeMessage } = await import("@/lib/non-e2ee-message");
const { afterMessageSent } = await import("@/lib/after-message-sent");
const { startDirectConversation } = await import("@/lib/direct-conversation");
const { prisma } = await import("@/lib/prisma");

const callee = { id: "callee", name: "Bo" };
const caller = { id: "caller", openToIntents: [] };

beforeEach(() => {
  vi.clearAllMocks();
  existingConversation = "conv1";
  membership = { hiddenAt: null };
  locked = false;
  insert = async () => ({ error: null, id: "msg1" });
});

describe("callReplyConversation", () => {
  it("uses the pair's 1:1 chat", async () => {
    expect(await callReplyConversation("callee", "caller")).toEqual({ error: null, conversationId: "conv1" });
  });

  it("has none yet: one is made on delivery", async () => {
    existingConversation = null;
    expect(await callReplyConversation("callee", "caller")).toEqual({ error: null, conversationId: null });
  });

  it("refuses a hidden chat that is locked right now", async () => {
    membership = { hiddenAt: new Date() };
    locked = true;
    expect(await callReplyConversation("callee", "caller")).toEqual({ error: "hidden_locked" });
  });

  it("refuses when the callee isn't a member of it", async () => {
    membership = null;
    expect(await callReplyConversation("callee", "caller")).toEqual({ error: "unavailable" });
  });
});

describe("deliverCallReply", () => {
  const input = { callee, caller, callId: "call1", content: "I'm in a meeting.", conversationId: "conv1" };

  it("sends one ordinary message from the callee under the call's key, and notifies the caller like any message", async () => {
    expect(await deliverCallReply(input)).toBe(true);
    expect(createNonE2eeMessage).toHaveBeenCalledWith({
      conversationId: "conv1",
      senderId: "callee",
      content: "I'm in a meeting.",
      mediaType: "NONE",
      moderationStatus: "PUBLISHED",
      clientRequestId: "call-reply:call1",
    });
    expect(prisma.call.update).toHaveBeenCalledWith({ where: { id: "call1" }, data: { declineReplyMessageId: "msg1" } });
    expect(afterMessageSent).toHaveBeenCalledWith(
      expect.objectContaining({ user: callee, conversationId: "conv1", memberIds: ["callee", "caller"], secret: false }),
    );
    expect(afterMessageSent).not.toHaveBeenCalledWith(expect.objectContaining({ quiet: true }));
  });

  it("starts the chat when the pair has none", async () => {
    expect(await deliverCallReply({ ...input, conversationId: null })).toBe(true);
    expect(startDirectConversation).toHaveBeenCalledWith("callee", caller, "call_reply");
    expect(createNonE2eeMessage).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "new-conv" }));
  });

  it("writes nothing into a secret chat", async () => {
    insert = async () => ({ error: "secret_chat" });
    expect(await deliverCallReply(input)).toBe(false);
    expect(prisma.call.update).not.toHaveBeenCalled();
    expect(afterMessageSent).not.toHaveBeenCalled();
  });

  it("never stores or announces a second message for the same call", async () => {
    insert = async () => {
      throw new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" });
    };
    expect(await deliverCallReply(input)).toBe(false);
    expect(afterMessageSent).not.toHaveBeenCalled();
  });

  it("never throws: the call is already declined", async () => {
    insert = async () => {
      throw new Error("pool timeout");
    };
    await expect(deliverCallReply(input)).resolves.toBe(false);
    expect(afterMessageSent).not.toHaveBeenCalled();
  });
});
