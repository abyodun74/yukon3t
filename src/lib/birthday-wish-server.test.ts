import { beforeEach, describe, expect, it, vi } from "vitest";

// sendBirthdayWishAs against mocked dependencies: the refusals, the one-per-year claim, the DM chokepoint and the
// celebrant's single combined notice.
const wishFindUnique = vi.fn();
const wishCreate = vi.fn();
const wishDelete = vi.fn();
const wishUpdate = vi.fn();
const wishCount = vi.fn();
const memberFindUnique = vi.fn();
const digestCreate = vi.fn();
const digestFindUnique = vi.fn();
const digestUpdate = vi.fn();
const notificationUpdate = vi.fn();
const notificationCreate = vi.fn();
const checkRateLimit = vi.fn();
const moderateText = vi.fn();
const createNonE2eeMessage = vi.fn();
const afterMessageSent = vi.fn();
const findDirectConversationId = vi.fn();
const startDirectConversation = vi.fn();
const getMembersHidingConversation = vi.fn();
const isMembershipLocked = vi.fn();
const webPush = vi.fn();
const fcm = vi.fn();
const birthdayWishContext = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    birthdayWish: {
      findUnique: (...a: unknown[]) => wishFindUnique(...a),
      create: (...a: unknown[]) => wishCreate(...a),
      delete: (...a: unknown[]) => wishDelete(...a),
      update: (...a: unknown[]) => wishUpdate(...a),
      count: (...a: unknown[]) => wishCount(...a),
    },
    conversationMember: { findUnique: (...a: unknown[]) => memberFindUnique(...a) },
    birthdayWishDigest: {
      create: (...a: unknown[]) => digestCreate(...a),
      findUnique: (...a: unknown[]) => digestFindUnique(...a),
      update: (...a: unknown[]) => digestUpdate(...a),
    },
    notification: {
      update: (...a: unknown[]) => notificationUpdate(...a),
      create: (...a: unknown[]) => notificationCreate(...a),
    },
  },
}));
vi.mock("@/lib/prisma-errors", () => ({
  isUniqueConstraintError: (err: unknown) => (err as { code?: string } | null)?.code === "P2002",
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
vi.mock("@/lib/moderation", () => ({ moderateText: (...a: unknown[]) => moderateText(...a) }));
vi.mock("@/lib/non-e2ee-message", () => ({ createNonE2eeMessage: (...a: unknown[]) => createNonE2eeMessage(...a) }));
vi.mock("@/lib/after-message-sent", () => ({ afterMessageSent: (...a: unknown[]) => afterMessageSent(...a) }));
vi.mock("@/lib/direct-conversation", () => ({
  findDirectConversationId: (...a: unknown[]) => findDirectConversationId(...a),
  startDirectConversation: (...a: unknown[]) => startDirectConversation(...a),
}));
vi.mock("@/lib/hidden-chats", () => ({
  getHiddenPeerIds: vi.fn().mockResolvedValue([]),
  getMembersHidingConversation: (...a: unknown[]) => getMembersHidingConversation(...a),
  isMembershipLocked: (...a: unknown[]) => isMembershipLocked(...a),
}));
vi.mock("@/lib/push", () => ({ sendPushToUser: (...a: unknown[]) => webPush(...a) }));
vi.mock("@/lib/fcm", () => ({ sendFcmActivityToUser: (...a: unknown[]) => fcm(...a) }));
vi.mock("@/lib/realtime-server", () => ({ notifyBadgeChange: vi.fn() }));
vi.mock("@/lib/error-tracking", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/birthdays-data", () => ({ birthdayWishContext: (...a: unknown[]) => birthdayWishContext(...a) }));

import { sendBirthdayWishAs } from "./birthday-wish-server";
import { notificationHref, type NotificationData } from "@/lib/notification-href";

const me = { id: "me", name: "Ada" };
const presets = {
  happyBirthday: "Happy birthday! Have a wonderful day.",
  wonderfulYear: "Wishing you a wonderful year ahead!",
  celebrateYou: "Hope your day is as great as you are!",
  bestWishes: "Best wishes on your birthday!",
};
const preset = { celebrantId: "bday", kind: "preset" as const, presetId: "bestWishes" as const };
const unique = Object.assign(new Error("dup"), { code: "P2002" });

type Payload = (locale: "en") => { title: string; body: string; url?: string; type?: string };

describe("sendBirthdayWishAs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimit.mockResolvedValue(true);
    birthdayWishContext.mockResolvedValue({ year: 2026, celebrant: { id: "bday", name: "Bo", openToIntents: [] } });
    wishFindUnique.mockResolvedValue(null);
    wishCreate.mockResolvedValue({ id: "wish1" });
    wishCount.mockResolvedValue(1);
    moderateText.mockResolvedValue({ allowed: true });
    findDirectConversationId.mockResolvedValue("conv1");
    memberFindUnique.mockResolvedValue({ hiddenAt: null });
    isMembershipLocked.mockResolvedValue(false);
    createNonE2eeMessage.mockResolvedValue({ error: null, id: "msg1" });
    getMembersHidingConversation.mockResolvedValue([]);
    digestCreate.mockResolvedValue({ id: "digest1" });
  });

  it("sends the wish as a direct message through the non-E2EE chokepoint, without the usual message push", async () => {
    expect(await sendBirthdayWishAs(me, preset, presets)).toEqual({ error: null, conversationId: "conv1" });
    expect(createNonE2eeMessage).toHaveBeenCalledWith({
      conversationId: "conv1",
      senderId: "me",
      content: "Best wishes on your birthday!",
      mediaType: "NONE",
      moderationStatus: "PUBLISHED",
    });
    expect(wishUpdate).toHaveBeenCalledWith({ where: { id: "wish1" }, data: { messageId: "msg1" } });
    expect(afterMessageSent).toHaveBeenCalledWith(expect.objectContaining({ conversationId: "conv1", quiet: true }));
  });

  it("refuses anyone the rules leave out with one answer, sending nothing", async () => {
    birthdayWishContext.mockResolvedValue(null);
    expect(await sendBirthdayWishAs(me, preset, presets)).toEqual({ error: "unavailable" });
    expect(wishCreate).not.toHaveBeenCalled();
    expect(createNonE2eeMessage).not.toHaveBeenCalled();
  });

  it("refuses wishing yourself", async () => {
    expect(await sendBirthdayWishAs(me, { ...preset, celebrantId: "me" }, presets)).toEqual({ error: "invalid" });
  });

  it("is rate limited per sender, and by the message limit", async () => {
    checkRateLimit.mockImplementation(async (name: string) => name !== "birthdayWish");
    expect(await sendBirthdayWishAs(me, preset, presets)).toEqual({ error: "rate_limited" });
    checkRateLimit.mockImplementation(async (name: string) => name !== "messageSend");
    expect(await sendBirthdayWishAs(me, preset, presets)).toEqual({ error: "rate_limited" });
    expect(createNonE2eeMessage).not.toHaveBeenCalled();
  });

  it("allows one wish per person per year, also when two arrive at once", async () => {
    wishFindUnique.mockResolvedValue({ id: "earlier" });
    expect(await sendBirthdayWishAs(me, preset, presets)).toEqual({ error: "already_wished" });
    wishFindUnique.mockResolvedValue(null);
    wishCreate.mockRejectedValue(unique);
    expect(await sendBirthdayWishAs(me, preset, presets)).toEqual({ error: "already_wished" });
    expect(createNonE2eeMessage).not.toHaveBeenCalled();
  });

  it("moderates custom text and refuses flagged text", async () => {
    moderateText.mockResolvedValue({ allowed: false });
    expect(await sendBirthdayWishAs(me, { celebrantId: "bday", kind: "custom", text: "nasty" }, presets)).toEqual({
      error: "moderation",
    });
    expect(moderateText).toHaveBeenCalledWith("nasty");
    expect(wishCreate).not.toHaveBeenCalled();
  });

  it("doesn't moderate the app's own emoji and ready-made messages", async () => {
    await sendBirthdayWishAs(me, { celebrantId: "bday", kind: "emoji", emoji: "🎂" }, presets);
    expect(moderateText).not.toHaveBeenCalled();
    expect(createNonE2eeMessage.mock.calls[0][0].content).toBe("🎂");
  });

  it("refuses a chat the sender has hidden and not unlocked", async () => {
    memberFindUnique.mockResolvedValue({ hiddenAt: new Date() });
    isMembershipLocked.mockResolvedValue(true);
    expect(await sendBirthdayWishAs(me, preset, presets)).toEqual({ error: "hidden_locked" });
    expect(wishCreate).not.toHaveBeenCalled();
  });

  it("releases the claim when the chat is a secret chat (the server can't write into one)", async () => {
    createNonE2eeMessage.mockResolvedValue({ error: "secret_chat" });
    expect(await sendBirthdayWishAs(me, preset, presets)).toEqual({ error: "unavailable" });
    expect(wishDelete).toHaveBeenCalledWith({ where: { id: "wish1" } });
    expect(afterMessageSent).not.toHaveBeenCalled();
    expect(webPush).not.toHaveBeenCalled();
  });

  it("releases the claim when sending fails outright, so the sender can try again", async () => {
    createNonE2eeMessage.mockRejectedValue(new Error("pool timeout"));
    await expect(sendBirthdayWishAs(me, preset, presets)).rejects.toThrow("pool timeout");
    expect(wishDelete).toHaveBeenCalledWith({ where: { id: "wish1" } });
  });

  it("opens a message request when the two have no chat yet, limited like any other", async () => {
    findDirectConversationId.mockResolvedValue(null);
    startDirectConversation.mockResolvedValue("conv-new");
    expect(await sendBirthdayWishAs(me, preset, presets)).toEqual({ error: null, conversationId: "conv-new" });
    expect(checkRateLimit).toHaveBeenCalledWith("connectionRequest", "me");
    expect(startDirectConversation).toHaveBeenCalledWith("me", expect.objectContaining({ id: "bday" }), "birthday_wish");

    vi.clearAllMocks();
    checkRateLimit.mockImplementation(async (name: string) => name !== "connectionRequest");
    birthdayWishContext.mockResolvedValue({ year: 2026, celebrant: { id: "bday", name: "Bo", openToIntents: [] } });
    wishFindUnique.mockResolvedValue(null);
    findDirectConversationId.mockResolvedValue(null);
    expect(await sendBirthdayWishAs(me, preset, presets)).toEqual({ error: "rate_limited" });
    expect(startDirectConversation).not.toHaveBeenCalled();
  });

  it("gives the celebrant one combined notice: the first wish creates it and is the only one pushed", async () => {
    await sendBirthdayWishAs(me, preset, presets);
    expect(digestCreate).toHaveBeenCalledTimes(1);
    expect(digestCreate.mock.calls[0][0].data).toMatchObject({
      year: 2026,
      celebrant: { connect: { id: "bday" } },
      notification: { create: { type: "BIRTHDAY_WISHES", actor: { connect: { id: "me" } } } },
    });
    expect(webPush).toHaveBeenCalledTimes(1);
    const payload = webPush.mock.calls[0][1] as Payload;
    expect(payload("en")).toEqual({ title: "Ada", body: "wished you a happy birthday", url: "/messages/conv1" });
    const row = {
      id: "n",
      type: "BIRTHDAY_WISHES",
      recipientId: "bday",
      readAt: null,
      createdAt: new Date(),
      actor: { id: "me", name: "Ada" },
      message: null,
      postId: null,
      circle: null,
      conversationId: "conv1",
      collab: null,
      liveStreamId: null,
      channel: null,
      museId: null,
      storyId: null,
    } satisfies NotificationData;
    expect(notificationHref(row)).toBe(payload("en").url);
  });

  it("updates that notice for later wishes, with a count and no push", async () => {
    digestCreate.mockRejectedValue(unique);
    digestFindUnique.mockResolvedValue({ id: "digest1", notificationId: "n1" });
    wishCount.mockResolvedValue(4);
    await sendBirthdayWishAs(me, preset, presets);
    expect(webPush).not.toHaveBeenCalled();
    expect(fcm).not.toHaveBeenCalled();
    expect(notificationUpdate).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: expect.objectContaining({ actorId: "me", messageData: "birthday_wishes:3", readAt: null }),
    });
  });

  it("treats a wish into a chat the celebrant has hidden like any hidden message: a neutral push, no named row", async () => {
    getMembersHidingConversation.mockResolvedValue(["bday"]);
    await sendBirthdayWishAs(me, preset, presets);
    expect(digestCreate).not.toHaveBeenCalled();
    const payload = webPush.mock.calls[0][1] as (locale: "en") => { title: string; body: string; url: string };
    expect(payload("en")).toEqual({ title: "YuKon3t", body: "You have a new notification", url: "/home" });
  });
});
