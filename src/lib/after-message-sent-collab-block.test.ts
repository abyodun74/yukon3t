import { beforeEach, describe, expect, it, vi } from "vitest";

// afterMessageSent and the collab group-chat block rule: a member blocked either way with the collab's author gets
// nothing at all for a new message in the collab's chat (no push, no FCM, no MESSAGE bell row, no badge signal), while
// everyone else gets the usual. Ordinary chats are untouched. Nothing about their membership is written, so the thread
// is there (unread) when the block is lifted.

const AUTHOR = "cau00000000001";
const PA = "cpa00000000001"; // blocked by the author
const PB = "cpb00000000001";
const PC = "cpc00000000001"; // blocked by PB only
const CHAT = "cchat000000001";
const PLAIN = "cplain00000001";

let blocks: [string, string][] = [];
let collabLookupFails = false;
let hiding: string[] = [];
const webPush = vi.fn();
const fcm = vi.fn();
const notificationCreateMany = vi.fn();
const publishEvents = vi.fn();
const memberWrites = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/trust", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/push", () => ({ sendPushToUsers: (ids: string[], p: unknown) => webPush(ids, p) }));
vi.mock("@/lib/fcm", () => ({ sendFcmActivityToUsers: (ids: string[], p: unknown) => fcm(ids, p) }));
vi.mock("@/lib/realtime-server", () => ({ publishEvents: (e: unknown) => publishEvents(e) }));
vi.mock("@/lib/hidden-chats", () => ({
  getMembersHidingConversation: async (_c: string, ids: string[]) => ids.filter((id) => hiding.includes(id)),
}));
vi.mock("@/lib/blocks", () => ({
  getBlockedEitherWayIds: async (a: string) =>
    new Set(blocks.flatMap(([x, y]) => (x === a ? [y] : y === a ? [x] : []))),
  isBlockedEitherWay: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (collabLookupFails) throw new Error("pool timeout");
        return { collabBoardPost: where.id === CHAT ? { authorId: AUTHOR } : null };
      },
    },
    conversationMember: { update: memberWrites, updateMany: memberWrites, deleteMany: memberWrites },
    notification: { createMany: (a: unknown) => notificationCreateMany(a) },
  },
}));

const { afterMessageSent } = await import("@/lib/after-message-sent");

const send = (conversationId: string, sender = AUTHOR) =>
  afterMessageSent({
    user: { id: sender, name: sender },
    conversationId,
    memberIds: [AUTHOR, PA, PB, PC],
    secret: false,
    content: "hello",
    mediaType: "NONE",
  });
const firstIds = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls[0]?.[0] as string[];
const rowRecipients = () =>
  (notificationCreateMany.mock.calls[0]?.[0] as { data: { recipientId: string }[] }).data.map((d) => d.recipientId);
const badgeRecipients = () =>
  (publishEvents.mock.calls[0][0] as { channel: string }[])
    .map((e) => e.channel)
    .filter((c) => !c.includes(CHAT) && !c.includes(PLAIN));

beforeEach(() => {
  vi.clearAllMocks();
  blocks = [
    [AUTHOR, PA],
    [PB, PC],
  ];
  collabLookupFails = false;
  hiding = [];
});

describe("afterMessageSent in a collab's group chat", () => {
  it("gives a member blocked with the author no push, no FCM, no bell row and no badge signal", async () => {
    await send(CHAT, PB);
    expect(firstIds(webPush)).toEqual([AUTHOR, PC]);
    expect(firstIds(fcm)).toEqual([AUTHOR, PC]);
    expect(rowRecipients()).toEqual([AUTHOR, PC]);
    const badges = badgeRecipients();
    expect(badges.some((c) => c.includes(PA))).toBe(false);
    expect(badges.filter((c) => c.includes(AUTHOR) || c.includes(PC))).toHaveLength(2);
    // The hidden-chat (generic) pushes went to nobody.
    expect(webPush.mock.calls[1][0]).toEqual([]);
    expect(memberWrites).not.toHaveBeenCalled();
  });

  it("the author's own message: the same, and a block between two participants changes nothing", async () => {
    await send(CHAT, AUTHOR);
    expect(firstIds(webPush)).toEqual([PB, PC]);
    expect(rowRecipients()).toEqual([PB, PC]);
  });

  it("everyone is notified again once the block is lifted", async () => {
    blocks = [];
    await send(CHAT, PB);
    expect(firstIds(webPush)).toEqual([AUTHOR, PA, PC]);
    expect(rowRecipients()).toEqual([AUTHOR, PA, PC]);
  });

  it("keeps the hidden-chat (PIN) rules for the others", async () => {
    hiding = [PC, PA];
    await send(CHAT, PB);
    expect(firstIds(webPush)).toEqual([AUTHOR]);
    expect(webPush.mock.calls[1][0]).toEqual([PC]); // generic push, PA nothing at all
    expect(rowRecipients()).toEqual([AUTHOR]);
  });

  it("if the collab lookup fails, nobody gets a named push (generic only) and the bell filters the rows at read time", async () => {
    collabLookupFails = true;
    await send(CHAT, PB);
    expect(firstIds(webPush)).toEqual([]);
    expect(webPush.mock.calls[1][0]).toEqual([AUTHOR, PA, PC]);
    expect(rowRecipients()).toEqual([AUTHOR, PA, PC]);
  });
});

describe("afterMessageSent in an ordinary chat", () => {
  it("is unaffected by the author's blocks", async () => {
    await send(PLAIN, PB);
    expect(firstIds(webPush)).toEqual([AUTHOR, PA, PC]);
    expect(rowRecipients()).toEqual([AUTHOR, PA, PC]);
  });
});

describe("afterMessageSent for a story reply (replyToStory)", () => {
  const reply = () =>
    afterMessageSent({
      user: { id: PB, name: "Bo" },
      conversationId: PLAIN,
      memberIds: [PB, AUTHOR],
      secret: false,
      content: "love it",
      mediaType: "NONE",
      storyReply: true,
    });

  it("gives the author one push and one FCM worded as a story reply, one bell row and the live signals", async () => {
    await reply();
    expect(firstIds(webPush)).toEqual([AUTHOR]);
    expect((webPush.mock.calls[0][1] as (l: string) => unknown)("en")).toEqual({
      title: "Bo",
      body: "Replied to your story: love it",
      url: `/messages/${PLAIN}`,
    });
    expect(webPush.mock.calls[1][0]).toEqual([]);
    expect(firstIds(fcm)).toEqual([AUTHOR]);
    expect((fcm.mock.calls[0][1] as (l: string) => { type: string; body: string })("es")).toMatchObject({
      type: "MESSAGE",
      body: "Respondió a tu historia: love it",
    });
    expect(rowRecipients()).toEqual([AUTHOR]);
    const channels = (publishEvents.mock.calls[0][0] as { channel: string }[]).map((e) => e.channel);
    expect(channels.some((c) => c.includes(AUTHOR))).toBe(true);
    expect(channels.some((c) => c.includes(PLAIN))).toBe(true);
  });

  it("an author hiding the DM gets only the generic push and no bell row", async () => {
    hiding = [AUTHOR];
    await reply();
    expect(firstIds(webPush)).toEqual([]);
    expect(webPush.mock.calls[1][0]).toEqual([AUTHOR]);
    expect(notificationCreateMany).not.toHaveBeenCalled();
  });
});
