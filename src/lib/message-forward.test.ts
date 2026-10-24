import { describe, expect, it } from "vitest";
import {
  FORWARD_MAX_RECIPIENTS,
  canOfferForward,
  forwardSourceRefusal,
  forwardTargetRefusal,
  forwardTargetsFor,
  forwardedMessageData,
  uniqueForwardTargets,
  type ForwardSource,
  type ForwardTargetRow,
} from "@/lib/message-forward";
import { forwardMessageSchema } from "@/lib/validations";

const text: ForwardSource = {
  content: "look https://example.com",
  mediaType: "NONE",
  mediaUrl: null,
  mediaThumbnailUrl: null,
  moderationStatus: "PUBLISHED",
  deletedForEveryoneAt: null,
  viewOnce: false,
  storyId: null,
};

describe("forwardSourceRefusal", () => {
  it("allows text, links and stored media", () => {
    expect(forwardSourceRefusal(text)).toBeNull();
    expect(forwardSourceRefusal({ ...text, content: "", mediaType: "IMAGE", mediaUrl: "https://r2/x.jpg" })).toBeNull();
    expect(forwardSourceRefusal({ ...text, content: "", mediaType: "AUDIO", mediaUrl: "https://r2/x.webm" })).toBeNull();
    expect(forwardSourceRefusal({ ...text, mediaType: "VIDEO", mediaUrl: "https://r2/x.mp4" })).toBeNull();
    expect(forwardSourceRefusal({ ...text, content: "", mediaType: "GIF", mediaUrl: "https://media.giphy.com/x.gif" })).toBeNull();
  });

  it("refuses deleted, held, view-once, story, ciphertext, empty and file-less messages", () => {
    expect(forwardSourceRefusal({ ...text, deletedForEveryoneAt: new Date() })).toBe("not_forwardable");
    expect(forwardSourceRefusal({ ...text, moderationStatus: "FLAGGED" })).toBe("not_forwardable");
    expect(forwardSourceRefusal({ ...text, moderationStatus: "REMOVED" })).toBe("not_forwardable");
    expect(forwardSourceRefusal({ ...text, content: "", mediaType: "IMAGE", viewOnce: true })).toBe("not_forwardable");
    expect(forwardSourceRefusal({ ...text, storyId: "s1" })).toBe("not_forwardable");
    expect(forwardSourceRefusal({ ...text, content: "e2ee:v1:abc" })).toBe("not_forwardable");
    expect(forwardSourceRefusal({ ...text, content: "  " })).toBe("not_forwardable");
    expect(forwardSourceRefusal({ ...text, mediaType: "IMAGE", mediaUrl: null })).toBe("not_forwardable");
  });
});

describe("canOfferForward", () => {
  const message = { ...text, story: null };
  it("is offered on an ordinary message", () => {
    expect(canOfferForward({ secretActive: false, sending: false, message })).toBe(true);
  });
  it("is never offered in a secret chat, on decrypted text, while sending, or on a story message", () => {
    expect(canOfferForward({ secretActive: true, sending: false, message })).toBe(false);
    expect(canOfferForward({ secretActive: false, wasEncrypted: true, sending: false, message })).toBe(false);
    expect(canOfferForward({ secretActive: false, sending: true, message })).toBe(false);
    expect(canOfferForward({ secretActive: false, sending: false, message: { ...message, story: { id: "s" } } })).toBe(false);
    expect(canOfferForward({ secretActive: false, sending: false, message: { ...message, viewOnce: true } })).toBe(false);
  });
});

describe("forwardedMessageData", () => {
  it("copies only the content, as the forwarder's own message marked forwarded", () => {
    const source = {
      ...text,
      mediaType: "VIDEO" as const,
      mediaUrl: "https://r2/v.mp4",
      mediaThumbnailUrl: "https://r2/v.jpg",
      // Fields a source row carries that must never reach the copy:
      senderId: "original-author",
      conversationId: "source-chat",
      replyToMessageId: "quoted",
    };
    const data = forwardedMessageData(source, { conversationId: "dest", senderId: "me" });
    expect(data).toEqual({
      conversationId: "dest",
      senderId: "me",
      content: text.content,
      mediaType: "VIDEO",
      mediaUrl: "https://r2/v.mp4",
      mediaThumbnailUrl: "https://r2/v.jpg",
      moderationStatus: "PUBLISHED",
      forwarded: true,
    });
    expect(JSON.stringify(data)).not.toContain("original-author");
    expect(JSON.stringify(data)).not.toContain("source-chat");
  });

  it("drops a stray thumbnail on a non-video and the url on text", () => {
    expect(forwardedMessageData({ ...text, mediaUrl: "x", mediaThumbnailUrl: "y" }, { conversationId: "d", senderId: "me" })).toMatchObject({
      mediaUrl: null,
      mediaThumbnailUrl: null,
    });
  });
});

function row(over: Partial<ForwardTargetRow> & { peer?: Partial<ForwardTargetRow["members"][number]["user"]>; secret?: boolean } = {}): ForwardTargetRow {
  const { peer, secret, ...rest } = over;
  const at = secret ? new Date() : null;
  return {
    id: "c1",
    isGroup: false,
    name: null,
    members: [
      { userId: "me", e2eeEnabledAt: at, user: { id: "me", name: "Me", username: "me", avatarUrl: null, status: "ACTIVE" } },
      {
        userId: "bo",
        e2eeEnabledAt: at,
        user: { id: "bo", name: "Bo", username: "bo", avatarUrl: "/api/avatar/bo/a-t.jpg", status: "ACTIVE", ...peer },
      },
    ],
    ...rest,
  };
}

describe("forwardTargetRefusal / forwardTargetsFor", () => {
  const none = new Set<string>();

  it("takes an ordinary 1:1 and a group", () => {
    expect(forwardTargetRefusal(row(), "me", none)).toBeNull();
    expect(forwardTargetRefusal(row({ isGroup: true, name: "Team", secret: true }), "me", none)).toBeNull();
  });

  it("refuses a secret chat, a blocked or inactive peer, and a chat the caller isn't in, all as 'unavailable'", () => {
    expect(forwardTargetRefusal(row({ secret: true }), "me", none)).toBe("unavailable");
    expect(forwardTargetRefusal(row(), "me", new Set(["bo"]))).toBe("unavailable");
    expect(forwardTargetRefusal(row({ peer: { status: "SUSPENDED" } }), "me", none)).toBe("unavailable");
    expect(forwardTargetRefusal(row(), "stranger", none)).toBe("unavailable");
  });

  it("lists only the chats that can take a forward, with the picker's fields only", () => {
    const list = forwardTargetsFor(
      [row(), row({ id: "c2", secret: true }), row({ id: "c3", isGroup: true, name: "Team" }), row({ id: "c4", peer: { id: "x" } })],
      "me",
      none,
    );
    expect(list.map((t) => t.id)).toEqual(["c1", "c2", "c3", "c4"].filter((id) => id !== "c2"));
    expect(list[0]).toEqual({ id: "c1", isGroup: false, label: "Bo", avatarUrl: "/api/avatar/bo/a-t.jpg", username: "bo" });
    expect(list[1]).toEqual({ id: "c3", isGroup: true, label: "Team", avatarUrl: null, username: null });
    expect(Object.keys(list[0])).not.toContain("status");
  });
});

describe("recipient cap", () => {
  const id = (n: number) => `ck${String(n).padStart(10, "0")}`;
  it("accepts 1..FORWARD_MAX_RECIPIENTS destinations and refuses more or none", () => {
    expect(FORWARD_MAX_RECIPIENTS).toBe(5);
    const ok = forwardMessageSchema.safeParse({ messageId: id(0), conversationIds: [1, 2, 3, 4, 5].map(id) });
    expect(ok.success).toBe(true);
    expect(forwardMessageSchema.safeParse({ messageId: id(0), conversationIds: [1, 2, 3, 4, 5, 6].map(id) }).success).toBe(false);
    expect(forwardMessageSchema.safeParse({ messageId: id(0), conversationIds: [] }).success).toBe(false);
    expect(forwardMessageSchema.safeParse({ messageId: "not a cuid", conversationIds: [id(1)] }).success).toBe(false);
  });
  it("de-duplicates the picked chats", () => {
    expect(uniqueForwardTargets(["a", "b", "a"])).toEqual(["a", "b"]);
  });
});
