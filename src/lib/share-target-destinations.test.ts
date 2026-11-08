import { describe, expect, it } from "vitest";
import {
  chatMessagesForShare,
  combineChatSendOutcomes,
  composerHandOffPath,
  postableShareChannels,
  shareCircleRole,
  shareTargetOptions,
  type ShareChannelCandidate,
} from "@/lib/share-target-destinations";

const none = { imageCount: 0, hasVideo: false, hasEmbed: false, videoDurationSeconds: null };

describe("shareTargetOptions", () => {
  it("offers Home, a Circle, Story and chats for screenshots, but not Muse", () => {
    expect(shareTargetOptions({ ...none, imageCount: 3 })).toEqual({
      story: true,
      muse: false,
      feed: true,
      circle: true,
      people: true,
    });
  });

  it("offers only chats for a share with no file and no embeddable link", () => {
    expect(shareTargetOptions(none)).toEqual({ story: false, muse: false, feed: false, circle: false, people: true });
  });

  it("offers everything for an embeddable link", () => {
    expect(shareTargetOptions({ ...none, hasEmbed: true })).toEqual({
      story: true,
      muse: true,
      feed: true,
      circle: true,
      people: true,
    });
  });

  it("applies the Story (2 min) and Muse (5 min) video ceilings", () => {
    const at = (s: number | null) => shareTargetOptions({ ...none, hasVideo: true, videoDurationSeconds: s });
    expect(at(120)).toMatchObject({ story: true, muse: true, feed: true, circle: true });
    expect(at(121)).toMatchObject({ story: false, muse: true });
    expect(at(300)).toMatchObject({ story: false, muse: true });
    expect(at(301)).toMatchObject({ story: false, muse: false, feed: true, circle: true });
    // An unknown length: Story fails open (the server checks), Muse needs it known.
    expect(at(null)).toMatchObject({ story: true, muse: false });
  });
});

function channel(over: Partial<ShareChannelCandidate>): ShareChannelCandidate {
  return {
    id: "ch",
    name: "general",
    slug: "general",
    type: "TEXT",
    visibility: "PUBLIC",
    position: 0,
    allowListed: false,
    ...over,
  };
}

describe("postableShareChannels (canAccessChannel's posting rule)", () => {
  const channels = [
    channel({ id: "staff", name: "staff", slug: "staff", visibility: "PRIVATE", position: 2 }),
    channel({ id: "general", position: 0 }),
    channel({ id: "voice", name: "lounge", slug: "lounge", type: "VOICE", position: 1 }),
    channel({ id: "vip", name: "vip", slug: "vip", visibility: "PRIVATE", position: 3, allowListed: true }),
    channel({ id: "photos", name: "photos", slug: "photos", position: 1 }),
  ];

  it("gives a member the public text channels and the private ones they're allow-listed in, in order", () => {
    expect(postableShareChannels(channels, { isMember: true, canModerate: false })).toEqual([
      { id: "general", name: "general", slug: "general", isPrivate: false },
      { id: "photos", name: "photos", slug: "photos", isPrivate: false },
      { id: "vip", name: "vip", slug: "vip", isPrivate: true },
    ]);
  });

  it("gives the owner/co-admin every text channel, private ones included", () => {
    expect(postableShareChannels(channels, { isMember: true, canModerate: true }).map((c) => c.id)).toEqual([
      "general",
      "photos",
      "staff",
      "vip",
    ]);
  });

  it("never offers a voice channel", () => {
    const ids = postableShareChannels(channels, { isMember: true, canModerate: true }).map((c) => c.id);
    expect(ids).not.toContain("voice");
  });

  it("offers nothing to a non-member, admin or not", () => {
    expect(postableShareChannels(channels, { isMember: false, canModerate: true })).toEqual([]);
  });

  it("leaves out a private channel the member isn't allow-listed in", () => {
    const ids = postableShareChannels(channels, { isMember: true, canModerate: false }).map((c) => c.id);
    expect(ids).not.toContain("staff");
  });
});

describe("shareCircleRole", () => {
  it("labels the creator owner, a MODERATOR co-admin and everyone else member", () => {
    expect(shareCircleRole({ createdById: "me" }, { role: "MEMBER" }, "me")).toBe("owner");
    expect(shareCircleRole({ createdById: "x" }, { role: "OWNER" }, "me")).toBe("owner");
    expect(shareCircleRole({ createdById: "x" }, { role: "MODERATOR" }, "me")).toBe("coadmin");
    expect(shareCircleRole({ createdById: "x" }, { role: "MEMBER" }, "me")).toBe("member");
  });
});

describe("chatMessagesForShare", () => {
  it("sends several photos one message each, in order, the caption with the first", () => {
    expect(chatMessagesForShare({ mediaType: "IMAGE", mediaUrls: ["a", "b", "c"] }, "  look  ")).toEqual([
      { content: "look", mediaType: "IMAGE", mediaUrl: "a" },
      { content: "", mediaType: "IMAGE", mediaUrl: "b" },
      { content: "", mediaType: "IMAGE", mediaUrl: "c" },
    ]);
  });

  it("sends a video as one message with its still frame", () => {
    expect(
      chatMessagesForShare({ mediaType: "VIDEO", mediaUrls: [], videoUrl: "v", videoThumbnailUrl: "t" }, "hi"),
    ).toEqual([{ content: "hi", mediaType: "VIDEO", mediaUrl: "v", mediaThumbnailUrl: "t" }]);
  });

  it("sends text alone when there's no file, and nothing when there's no text either", () => {
    expect(chatMessagesForShare({ mediaType: "NONE", mediaUrls: [] }, "https://example.com")).toEqual([
      { content: "https://example.com", mediaType: "NONE" },
    ]);
    expect(chatMessagesForShare({ mediaType: "NONE", mediaUrls: [] }, "  ")).toEqual([]);
  });
});

describe("combineChatSendOutcomes", () => {
  it("passes a single message's answer through", () => {
    expect(combineChatSendOutcomes([{ sent: 2, failed: 1 }], 3)).toEqual({ sent: 2, failed: 1 });
  });

  it("lets the first message's error stand for the whole share", () => {
    expect(combineChatSendOutcomes([{ error: "moderation", message: "no" }], 2)).toEqual({
      error: "moderation",
      message: "no",
    });
  });

  it("counts a chat as sent only if every photo reached it", () => {
    expect(combineChatSendOutcomes([{ sent: 3, failed: 0 }, { sent: 2, failed: 1 }, { sent: 3, failed: 0 }], 3)).toEqual({
      sent: 2,
      failed: 1,
    });
  });

  it("never reports a clean send when a later photo failed", () => {
    expect(combineChatSendOutcomes([{ sent: 2, failed: 0 }, { error: "rate_limited" }], 2)).toEqual({
      sent: 0,
      failed: 2,
    });
  });

  it("answers unavailable when nothing was sent at all", () => {
    expect(combineChatSendOutcomes([], 1)).toEqual({ error: "unavailable" });
  });
});

describe("composerHandOffPath", () => {
  it("sends a Home post to the profile composer and a Circle post to that channel's composer", () => {
    expect(composerHandOffPath({ kind: "feed", userId: "u1" })).toBe("/u/u1?compose=1");
    expect(composerHandOffPath({ kind: "circle", circleSlug: "book club", channelSlug: "général" })).toBe(
      "/circles/book%20club?channel=g%C3%A9n%C3%A9ral",
    );
  });
});
