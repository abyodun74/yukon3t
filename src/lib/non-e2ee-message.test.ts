import { beforeEach, describe, expect, it, vi } from "vitest";

// createNonE2eeMessage: the one chokepoint every server-built chat message (shares, forwards, story replies) is
// written through. It re-reads the destination inside the insert's transaction and refuses a secret chat.

type Row = { isGroup: boolean; e2eeEnabledAt: Date | null };
let rows: Row[] = [];
const queryRaw = vi.fn();
const messageCreate = vi.fn();

vi.mock("@/lib/prisma", () => {
  const tx = {
    $queryRaw: (sql: TemplateStringsArray, ...values: unknown[]) => queryRaw(sql.join("?"), ...values),
    message: { create: (...a: unknown[]) => messageCreate(...a) },
  };
  return { prisma: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
});

import { createNonE2eeMessage } from "@/lib/non-e2ee-message";

const on = new Date();
const data = { conversationId: "cconv000000001", senderId: "cme00000000001", content: "https://yukon3t.com/post/x" };

beforeEach(() => {
  vi.clearAllMocks();
  queryRaw.mockImplementation(async () => rows);
  messageCreate.mockResolvedValue({ id: "cmsg0000000001" });
});

describe("createNonE2eeMessage", () => {
  it("writes into an ordinary 1:1", async () => {
    rows = [
      { isGroup: false, e2eeEnabledAt: null },
      { isGroup: false, e2eeEnabledAt: null },
    ];
    expect(await createNonE2eeMessage(data)).toEqual({ error: null, id: "cmsg0000000001" });
    expect(messageCreate).toHaveBeenCalledWith({ data, select: { id: true } });
  });

  it("writes into a 1:1 where only one side has opted in (not a secret chat yet)", async () => {
    rows = [
      { isGroup: false, e2eeEnabledAt: on },
      { isGroup: false, e2eeEnabledAt: null },
    ];
    expect((await createNonE2eeMessage(data)).error).toBeNull();
  });

  it("writes into a group (groups are never secret)", async () => {
    rows = [
      { isGroup: true, e2eeEnabledAt: on },
      { isGroup: true, e2eeEnabledAt: on },
      { isGroup: true, e2eeEnabledAt: on },
    ];
    expect((await createNonE2eeMessage(data)).error).toBeNull();
  });

  it("refuses a secret chat with secret_chat and writes nothing, whatever the message carries", async () => {
    rows = [
      { isGroup: false, e2eeEnabledAt: on },
      { isGroup: false, e2eeEnabledAt: on },
    ];
    for (const d of [
      data,
      { ...data, content: "", mediaType: "VIDEO" as const, mediaUrl: "https://media.example/m.mp4" },
      { ...data, content: "Shared a story", storyId: "csto0000000001", isForwardedStory: true },
      { ...data, content: "", mediaType: "IMAGE" as const, mediaUrl: "https://media.example/p.jpg", forwarded: true },
    ]) {
      expect(await createNonE2eeMessage(d)).toEqual({ error: "secret_chat" });
    }
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it("reads the destination's members under a lock, by the message's own conversation id", async () => {
    rows = [];
    await createNonE2eeMessage(data);
    const [sql, ...values] = queryRaw.mock.calls[0];
    expect(values).toEqual([data.conversationId]);
    expect(sql).toMatch(/FROM "ConversationMember"/);
    expect(sql).toMatch(/FOR SHARE/);
  });
});
