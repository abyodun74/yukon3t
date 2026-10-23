import { describe, expect, it } from "vitest";
import {
  lockedConversationIds,
  translatableCommentsWhere,
  translatableEventUpdatesWhere,
  translatableMessagesWhere,
  translatablePostsWhere,
} from "./translation-access";
import { buildVisiblePostsWhere } from "@/lib/post-visibility";

const visible = buildVisiblePostsWhere({
  viewerId: "viewer",
  circleIds: ["c1"],
  connectionUserIds: ["friend"],
  blockedIds: new Set(["blocked"]),
});

describe("translation authorization", () => {
  it("translates an organizer update only on an event post the viewer can see, by an author they can see", () => {
    const where = translatableEventUpdatesWhere(["u1"], visible, new Set(["blocked"]), "viewer");
    expect(where.id).toEqual({ in: ["u1"] });
    expect(where.author).toEqual({ status: "ACTIVE" });
    expect(where.authorId).toEqual({ notIn: ["blocked"] });
    const post = where.post as { AND: unknown[] };
    expect(post.AND[0]).toBe(visible);
    // A PRIVATE channel's event: its allow-list, the Circle's owner and co-admins only (as loadCircleEventAccess).
    expect(post.AND[1]).toEqual({
      OR: [
        { channelId: null },
        { channel: { visibility: "PUBLIC" } },
        { channel: { members: { some: { userId: "viewer" } } } },
        { circle: { createdById: "viewer" } },
        { circle: { members: { some: { userId: "viewer", role: { not: "MEMBER" } } } } },
      ],
    });
    expect(translatableEventUpdatesWhere(["u1"], visible, new Set(), "viewer").authorId).toBeUndefined();
  });
  it("translates only posts the viewer's own visibility rules allow", () => {
    const where = translatablePostsWhere(["p1", "p2"], visible);
    expect(where).toEqual({ AND: [{ id: { in: ["p1", "p2"] } }, visible] });
    // The visibility fragment itself excludes held/removed posts and blocked authors.
    expect(visible.moderationStatus).toBe("PUBLISHED");
    expect(JSON.stringify(visible.NOT)).toContain("blocked");
  });

  it("translates only published comments by unblocked active authors on visible posts", () => {
    const where = translatableCommentsWhere(["k1"], visible, new Set(["blocked"]));
    expect(where).toMatchObject({
      id: { in: ["k1"] },
      moderationStatus: "PUBLISHED",
      author: { status: "ACTIVE" },
      authorId: { notIn: ["blocked"] },
      post: visible,
    });
    expect(translatableCommentsWhere(["k1"], visible, new Set())).not.toHaveProperty("authorId");
  });

  it("translates only live, published, non-view-once messages in the viewer's own conversations", () => {
    expect(translatableMessagesWhere(["m1"], "viewer")).toEqual({
      id: { in: ["m1"] },
      moderationStatus: "PUBLISHED",
      deletedForEveryoneAt: null,
      viewOnce: false,
      NOT: { deletedForUserIds: { has: "viewer" } },
      conversation: { members: { some: { userId: "viewer" } } },
    });
  });

  it("refuses messages in hidden chats unless the PIN unlock is live", () => {
    const memberships = [
      { conversationId: "open", hiddenAt: null },
      { conversationId: "hidden", hiddenAt: new Date() },
    ];
    expect([...lockedConversationIds(memberships, false)]).toEqual(["hidden"]);
    expect([...lockedConversationIds(memberships, true)]).toEqual([]);
  });
});
