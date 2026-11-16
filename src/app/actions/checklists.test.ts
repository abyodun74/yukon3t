import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared checklist messages against a mocked database: the row actions in checklists.ts, and sendMessage's checklist
// branch (stored as rows, content written by the server, refused in a secret chat).

const ME = "cme00000000001";
const BO = "cbo00000000001";
const CONV = "cconv000000001";
const MSG = "cmsg0000000001";
const LIST = "clist000000001";
const ITEM = "citem000000001";

const user = { id: ME, name: "Me", isAdmin: false };
let limited = false;
const moderateText = vi.fn();
const publishEvent = vi.fn();
const itemUpdateMany = vi.fn();
const itemDeleteMany = vi.fn();
const itemCreate = vi.fn();
const messageCreate = vi.fn();
const afterMessageSent = vi.fn();
let blocked = false;
let locked = false;
let isGroup = false;
let secret = false;
let isMember = true;
let itemCount = 2;
let message: { deletedForEveryoneAt: Date | null; deletedForUserIds: string[]; moderationStatus: string };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => !limited }));
vi.mock("@/lib/moderation", () => ({ moderateText: (t: string) => moderateText(t), moderateMedia: vi.fn() }));
vi.mock("@/lib/storage", () => ({ MEDIA_LIMITS: {}, verifyUploadedSize: vi.fn(), keyFromPublicUrl: vi.fn() }));
vi.mock("@/lib/owned-uploads", () => ({ deleteOwnedUploads: vi.fn() }));
vi.mock("@/lib/video-thumbnail-check", () => ({ checkVideoThumbnail: vi.fn() }));
vi.mock("@/lib/media-cleanup", () => ({ deleteMediaIfUnreferenced: vi.fn() }));
vi.mock("@/lib/embeddings", () => ({ updateConversationEmbedding: vi.fn() }));
vi.mock("@/lib/translation-server", () => ({ deleteTranslationsOf: vi.fn() }));
vi.mock("@/lib/view-once-media", () => ({ destroyViewOnceMedia: vi.fn() }));
vi.mock("@/lib/realtime-server", () => ({ publishEvent: (...a: unknown[]) => publishEvent(...a), publishEvents: vi.fn() }));
vi.mock("@/lib/after-message-sent", () => ({ afterMessageSent: (...a: unknown[]) => afterMessageSent(...a) }));
vi.mock("@/lib/non-e2ee-message", () => ({ createNonE2eeMessage: vi.fn() }));
vi.mock("@/lib/blocks", () => ({
  isBlockedEitherWay: async () => blocked,
  getBlockedEitherWayIds: async () => new Set<string>(),
  isBlockedWithAny: async () => false,
}));
vi.mock("@/lib/hidden-chats", () => ({
  isMembershipLocked: async () => locked,
  isConversationLocked: async () => locked,
}));
vi.mock("@/lib/collab-chat-visibility-server", () => ({ collabChatHiddenFor: async () => false }));

function conversation() {
  return {
    isGroup,
    members: [
      { userId: ME, e2eeEnabledAt: secret ? new Date() : null },
      { userId: BO, e2eeEnabledAt: secret ? new Date() : null },
    ],
  };
}

vi.mock("@/lib/prisma", () => {
  const prisma = {
    checklistMessage: {
      findUnique: async ({ select }: { select: Record<string, unknown> }) =>
        "message" in select
          ? { id: LIST, message: { conversationId: CONV, ...message, conversation: conversation() } }
          : { id: LIST, title: "Groceries", items: [] },
    },
    checklistItem: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === ITEM ? { checklistId: LIST } : null),
      updateMany: (...a: unknown[]) => itemUpdateMany(...a),
      deleteMany: (...a: unknown[]) => itemDeleteMany(...a),
      count: async () => itemCount,
      findFirst: async () => (itemCount > 0 ? { position: itemCount - 1 } : null),
      create: (...a: unknown[]) => itemCreate(...a),
    },
    conversationMember: { findUnique: async () => (isMember ? { hiddenAt: null } : null) },
    conversation: { findUnique: async () => conversation() },
    message: { create: (...a: unknown[]) => messageCreate(...a), findUnique: async () => null },
    $executeRaw: vi.fn(async () => 0),
    $transaction: async (arg: unknown): Promise<unknown> =>
      typeof arg === "function" ? arg(prisma) : Promise.all(arg as unknown[]),
  };
  return { prisma };
});

const { setChecklistItemChecked, addChecklistItem, editChecklistItem, removeChecklistItem } = await import("./checklists");
const { sendMessage } = await import("./messages");

beforeEach(() => {
  vi.clearAllMocks();
  limited = false;
  blocked = false;
  locked = false;
  isGroup = false;
  secret = false;
  isMember = true;
  itemCount = 2;
  message = { deletedForEveryoneAt: null, deletedForUserIds: [], moderationStatus: "PUBLISHED" };
  moderateText.mockResolvedValue({ allowed: true });
  itemUpdateMany.mockResolvedValue({ count: 1 });
  itemDeleteMany.mockResolvedValue({ count: 1 });
  messageCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: MSG, ...data }));
});

describe("setChecklistItemChecked", () => {
  it("ticks only an unticked row, scoped to its list, and tells open threads", async () => {
    const result = await setChecklistItemChecked(ITEM, true);
    expect(result.error).toBeNull();
    expect(itemUpdateMany).toHaveBeenCalledWith({
      where: { id: ITEM, checklistId: LIST, checkedAt: null },
      data: { checkedAt: expect.any(Date), checkedById: ME },
    });
    expect(publishEvent).toHaveBeenCalledWith(expect.stringContaining(CONV), "changed");
  });

  it("unticks only a ticked row", async () => {
    await setChecklistItemChecked(ITEM, false);
    expect(itemUpdateMany).toHaveBeenCalledWith({
      where: { id: ITEM, checklistId: LIST, checkedAt: { not: null } },
      data: { checkedAt: null, checkedById: null },
    });
  });

  it("works in a group and for any member, not only the sender", async () => {
    isGroup = true;
    expect((await setChecklistItemChecked(ITEM, true)).error).toBeNull();
  });

  it("can still be ticked in a chat that became secret (no text is written)", async () => {
    secret = true;
    expect((await setChecklistItemChecked(ITEM, true)).error).toBeNull();
  });

  it.each([
    ["a non-member", () => (isMember = false), "not_found"],
    ["a hidden chat that is locked", () => (locked = true), "hidden_locked"],
    ["a 1:1 with a block either way", () => (blocked = true), "blocked"],
    ["a message deleted for everyone", () => (message.deletedForEveryoneAt = new Date()), "not_found"],
    ["a message deleted for the caller", () => (message.deletedForUserIds = [ME]), "not_found"],
    ["a message held by moderation", () => (message.moderationStatus = "FLAGGED"), "not_found"],
    ["the rate limit", () => (limited = true), "rate_limited"],
  ])("refuses %s and writes nothing", async (_label, arrange, error) => {
    arrange();
    expect((await setChecklistItemChecked(ITEM, true)).error).toBe(error);
    expect(itemUpdateMany).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it("refuses a malformed id or an unknown row", async () => {
    expect((await setChecklistItemChecked("nope", true)).error).toBe("invalid");
    expect((await setChecklistItemChecked("cother00000001", true)).error).toBe("not_found");
  });
});

describe("addChecklistItem", () => {
  it("adds a moderated, cleaned row at the end", async () => {
    const result = await addChecklistItem(LIST, "  Oat   milk ");
    expect(result.error).toBeNull();
    expect(moderateText).toHaveBeenCalledWith("Oat milk");
    expect(itemCreate).toHaveBeenCalledWith({ data: { checklistId: LIST, text: "Oat milk", position: 2, addedById: ME } });
  });

  it("refuses flagged text without storing it", async () => {
    moderateText.mockResolvedValue({ allowed: false });
    expect((await addChecklistItem(LIST, "bad")).error).toBe("moderation");
    expect(itemCreate).not.toHaveBeenCalled();
  });

  it("refuses a 31st row", async () => {
    itemCount = 30;
    expect((await addChecklistItem(LIST, "one more")).error).toBe("full");
    expect(itemCreate).not.toHaveBeenCalled();
  });

  it("refuses blank text and any text in a secret chat", async () => {
    expect((await addChecklistItem(LIST, "   ")).error).toBe("invalid");
    secret = true;
    expect((await addChecklistItem(LIST, "Milk")).error).toBe("not_supported_in_secret_chat");
    expect(itemCreate).not.toHaveBeenCalled();
    expect(moderateText).not.toHaveBeenCalled();
  });
});

describe("editChecklistItem / removeChecklistItem", () => {
  it("rewrites a row's text within its list", async () => {
    expect((await editChecklistItem(ITEM, "Eggs (12)")).error).toBeNull();
    expect(itemUpdateMany).toHaveBeenCalledWith({ where: { id: ITEM, checklistId: LIST }, data: { text: "Eggs (12)" } });
  });

  it("refuses an edit in a secret chat", async () => {
    secret = true;
    expect((await editChecklistItem(ITEM, "Eggs")).error).toBe("not_supported_in_secret_chat");
    expect(itemUpdateMany).not.toHaveBeenCalled();
  });

  it("removes a row within its list", async () => {
    expect((await removeChecklistItem(ITEM)).error).toBeNull();
    expect(itemDeleteMany).toHaveBeenCalledWith({ where: { id: ITEM, checklistId: LIST } });
  });
});

describe("sendMessage with a checklist", () => {
  function form(checklist: unknown, extra: Record<string, string> = {}) {
    const fd = new FormData();
    fd.set("conversationId", CONV);
    fd.set("content", "ignored by the server");
    fd.set("checklist", typeof checklist === "string" ? checklist : JSON.stringify(checklist));
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    return fd;
  }

  it("stores the rows and writes the one-line stand-in as content", async () => {
    const result = await sendMessage(form({ title: "Groceries", items: ["Milk", "  ", "Eggs"] }));
    expect(result.error).toBeNull();
    const data = messageCreate.mock.calls[0][0].data;
    expect(data.content).toBe("🛒 Groceries");
    expect(data.checklist.create.title).toBe("Groceries");
    expect(data.checklist.create.items.create).toEqual([
      { text: "Milk", position: 0, addedById: ME },
      { text: "Eggs", position: 1, addedById: ME },
    ]);
    expect(moderateText).toHaveBeenCalledWith("Groceries\nMilk\nEggs");
  });

  it("holds a flagged list for review like any text", async () => {
    moderateText.mockResolvedValue({ allowed: false });
    await sendMessage(form({ title: "Groceries", items: ["Milk"] }));
    expect(messageCreate.mock.calls[0][0].data.moderationStatus).toBe("FLAGGED");
  });

  it("refuses a checklist in a secret chat", async () => {
    secret = true;
    expect((await sendMessage(form({ title: "Groceries", items: ["Milk"] }))).error).toBe("not_supported_in_secret_chat");
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", "{"],
    ["no items", { title: "Groceries", items: [] }],
    ["only blank items", { title: "Groceries", items: [" "] }],
    ["no title", { title: " ", items: ["Milk"] }],
    ["too many items", { title: "Groceries", items: Array.from({ length: 31 }, (_, i) => `i${i}`) }],
  ])("refuses %s", async (_label, payload) => {
    expect((await sendMessage(form(payload))).error).toBe("invalid");
    expect(messageCreate).not.toHaveBeenCalled();
  });

  it("refuses a checklist with media", async () => {
    expect((await sendMessage(form({ title: "G", items: ["Milk"] }, { mediaType: "GIF", mediaUrl: "https://media.giphy.com/a.gif" }))).error).toBe(
      "invalid",
    );
  });
});
