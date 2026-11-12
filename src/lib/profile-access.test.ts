import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canSeeProfileContent,
  canSeeStoriesOf,
  profileIsListed,
  STORY_TRAY_AUTHOR_WHERE,
  type ProfileOwner,
} from "@/lib/profile-access";
import { channelFeedPostsWhere } from "@/lib/post-visibility";

// Read actions used to skip checks their pages make (security review item 9): Story actions ignored the author's
// friends-only/hidden rule, the subscriber lists and profile-post paging didn't check the profile exists for the
// viewer, a Circle channel's "load more" showed blocked/banned authors, and a private collab's live-session list was
// readable by id. One rule now serves page and action alike.

const VIEWER = "cvi00000000001";
const FRIEND = "cfr00000000001";
const STRANGER = "cst00000000001";
const ADMIN = "cad00000000001";
const HIDDEN = "chi00000000001";
const GONE = "cgo00000000001";

const owner = (id: string, over: Partial<ProfileOwner> = {}): ProfileOwner => ({
  id,
  status: "ACTIVE",
  name: id,
  isAdmin: false,
  isGuestPreview: false,
  postsVisibility: "PUBLIC",
  ...over,
});

describe("profile-access rules", () => {
  it("lists only ACTIVE, named, non-guest profiles, and an admin only to themselves", () => {
    expect(profileIsListed(owner(FRIEND), VIEWER)).toBe(true);
    expect(profileIsListed(owner(GONE, { status: "SUSPENDED" }), VIEWER)).toBe(false);
    expect(profileIsListed(owner(FRIEND, { name: null }), VIEWER)).toBe(false);
    expect(profileIsListed(owner(FRIEND, { isGuestPreview: true }), VIEWER)).toBe(false);
    expect(profileIsListed(owner(ADMIN, { isAdmin: true }), VIEWER)).toBe(false);
    expect(profileIsListed(owner(ADMIN, { isAdmin: true }), ADMIN)).toBe(true);
  });

  it("shows content PUBLIC to anyone, CONNECTIONS_ONLY to connections, HIDDEN to nobody but the owner", () => {
    const base = { viewerId: VIEWER, iBlockedThem: false, connected: false };
    expect(canSeeProfileContent({ ...base, owner: owner(STRANGER) })).toBe(true);
    expect(canSeeProfileContent({ ...base, owner: owner(STRANGER, { postsVisibility: "CONNECTIONS_ONLY" }) })).toBe(false);
    expect(
      canSeeProfileContent({ ...base, connected: true, owner: owner(FRIEND, { postsVisibility: "CONNECTIONS_ONLY" }) }),
    ).toBe(true);
    expect(canSeeProfileContent({ ...base, connected: true, owner: owner(HIDDEN, { postsVisibility: "HIDDEN" }) })).toBe(
      false,
    );
    expect(canSeeProfileContent({ ...base, iBlockedThem: true, owner: owner(STRANGER) })).toBe(false);
    expect(
      canSeeProfileContent({ ...base, viewerId: HIDDEN, owner: owner(HIDDEN, { postsVisibility: "HIDDEN" }) }),
    ).toBe(true);
  });

  it("applies the profile rule plus blocks either way to Stories", () => {
    const base = { viewerId: VIEWER, blockedEitherWay: false, connected: false };
    expect(canSeeStoriesOf({ ...base, owner: owner(STRANGER) })).toBe(true);
    expect(canSeeStoriesOf({ ...base, owner: owner(STRANGER, { postsVisibility: "CONNECTIONS_ONLY" }) })).toBe(false);
    expect(canSeeStoriesOf({ ...base, connected: true, owner: owner(FRIEND, { postsVisibility: "CONNECTIONS_ONLY" }) })).toBe(
      true,
    );
    expect(canSeeStoriesOf({ ...base, blockedEitherWay: true, owner: owner(STRANGER) })).toBe(false);
    expect(canSeeStoriesOf({ ...base, connected: true, owner: owner(ADMIN, { isAdmin: true }) })).toBe(false);
    expect(canSeeStoriesOf({ ...base, connected: true, owner: owner(HIDDEN, { postsVisibility: "HIDDEN" }) })).toBe(false);
    expect(canSeeStoriesOf({ ...base, connected: true, owner: owner(GONE, { status: "BANNED" }) })).toBe(false);
  });

  it("filters the Story tray by the same account-level rule", () => {
    expect(STORY_TRAY_AUTHOR_WHERE).toEqual({
      status: "ACTIVE",
      name: { not: null },
      isAdmin: false,
      isGuestPreview: false,
      postsVisibility: { not: "HIDDEN" },
    });
  });
});

describe("channelFeedPostsWhere", () => {
  it("drops blocked-either-way and inactive authors, published lead posts only", () => {
    expect(channelFeedPostsWhere("ch1", new Set([STRANGER]))).toEqual({
      channelId: "ch1",
      moderationStatus: "PUBLISHED",
      author: { status: "ACTIVE" },
      authorId: { notIn: [STRANGER] },
      OR: [{ albumId: null }, { albumIndex: 0 }],
    });
    expect(channelFeedPostsWhere("ch1", new Set())).not.toHaveProperty("authorId");
  });

  it("is what both the Circle page and loadMoreCirclePosts query", () => {
    expect(readFileSync("src/app/circles/[slug]/page.tsx", "utf8")).toContain("channelFeedPostsWhere(activeChannel.id");
    expect(readFileSync("src/app/actions/circles.ts", "utf8")).toContain("channelFeedPostsWhere(channel.id");
  });
});

// ---- server half, against a mocked database ----

const users: Record<string, ProfileOwner> = {
  [FRIEND]: owner(FRIEND, { postsVisibility: "CONNECTIONS_ONLY" }),
  [STRANGER]: owner(STRANGER, { postsVisibility: "CONNECTIONS_ONLY" }),
  [ADMIN]: owner(ADMIN, { isAdmin: true }),
  [HIDDEN]: owner(HIDDEN, { postsVisibility: "HIDDEN" }),
};
const connected = new Set([FRIEND, HIDDEN, ADMIN]);
let blockedEither = new Set<string>();
const future = new Date(Date.now() + 3_600_000);
const stories: Record<string, { id: string; authorId: string; expiresAt: Date }> = {
  sFriend: { id: "sFriend", authorId: FRIEND, expiresAt: future },
  sStranger: { id: "sStranger", authorId: STRANGER, expiresAt: future },
  sHidden: { id: "sHidden", authorId: HIDDEN, expiresAt: future },
  sAdmin: { id: "sAdmin", authorId: ADMIN, expiresAt: future },
  sMine: { id: "sMine", authorId: VIEWER, expiresAt: future },
  sOld: { id: "sOld", authorId: FRIEND, expiresAt: new Date(Date.now() - 1000) },
};

vi.mock("@/lib/blocks", () => ({
  isBlockedEitherWay: async (_a: string, b: string) => blockedEither.has(b),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: async ({ where }: { where: { id: string } }) => users[where.id] ?? null },
    connection: {
      findFirst: async ({ where }: { where: { OR: { requesterId: string; targetId: string }[] } }) =>
        connected.has(where.OR[0].targetId) ? { id: "c" } : null,
    },
    block: {
      findUnique: async ({ where }: { where: { blockerId_blockedId: { blockedId: string } } }) =>
        blockedEither.has(where.blockerId_blockedId.blockedId) ? { id: "b" } : null,
    },
    story: { findUnique: async ({ where }: { where: { id: string } }) => stories[where.id] ?? null },
  },
}));

const { loadViewableStory, viewerCanSeeProfilePosts } = await import("@/lib/profile-access-server");

describe("loadViewableStory", () => {
  beforeEach(() => {
    blockedEither = new Set();
  });

  it("returns a story only when its author's Stories are visible to the viewer", async () => {
    expect(await loadViewableStory(VIEWER, "sFriend")).toMatchObject({ id: "sFriend" });
    expect(await loadViewableStory(VIEWER, "sMine")).toMatchObject({ id: "sMine" });
    expect(await loadViewableStory(VIEWER, "sStranger")).toBeNull(); // friends-only, not connected
    expect(await loadViewableStory(VIEWER, "sHidden")).toBeNull(); // HIDDEN, even to a connection
    expect(await loadViewableStory(VIEWER, "sAdmin")).toBeNull(); // admins are invisible
    expect(await loadViewableStory(VIEWER, "sOld")).toBeNull(); // expired
    expect(await loadViewableStory(VIEWER, "nope")).toBeNull();
    expect(await loadViewableStory(VIEWER, 42)).toBeNull();
    blockedEither = new Set([FRIEND]);
    expect(await loadViewableStory(VIEWER, "sFriend")).toBeNull();
  });
});

describe("viewerCanSeeProfilePosts", () => {
  it("mirrors the profile page: hidden admins, HIDDEN accounts and friends-only strangers get nothing", async () => {
    blockedEither = new Set();
    expect(await viewerCanSeeProfilePosts(VIEWER, FRIEND)).toBe(true);
    expect(await viewerCanSeeProfilePosts(VIEWER, STRANGER)).toBe(false);
    expect(await viewerCanSeeProfilePosts(VIEWER, ADMIN)).toBe(false);
    expect(await viewerCanSeeProfilePosts(ADMIN, ADMIN)).toBe(true);
    expect(await viewerCanSeeProfilePosts(VIEWER, HIDDEN)).toBe(false);
    expect(await viewerCanSeeProfilePosts(VIEWER, "missing")).toBe(false);
  });
});

describe("every Story action that takes a story id goes through loadViewableStory", () => {
  it("is called by each of them", () => {
    const source = readFileSync("src/app/actions/stories.ts", "utf8");
    for (const name of [
      "viewStory",
      "getStoryReactionSummary",
      "toggleStoryReaction",
      "replyToStory",
      "getStory",
      "shareStoryToConversations",
      "getStoryComments",
      "createStoryComment",
    ]) {
      const start = source.indexOf(`export async function ${name}(`);
      expect(start, name).toBeGreaterThan(-1);
      const next = source.indexOf("export async function", start + 10);
      const body = source.slice(start, next === -1 ? undefined : next);
      expect(body, name).toContain("loadViewableStory(user.id, storyId)");
    }
  });

  it("and the subscriber lists, profile-post paging and the collab session list check the page's rule", () => {
    const subs = readFileSync("src/app/actions/subscriptions.ts", "utf8");
    expect(subs.match(/canPageSubscriptions\(viewer\.id/g)).toHaveLength(2);
    expect(readFileSync("src/app/actions/posts.ts", "utf8")).toContain("viewerCanSeeProfilePosts(viewer.id, profileUserId)");
    expect(readFileSync("src/app/actions/collab-session.ts", "utf8")).toContain("viewerCanSeeCollab(collabId, viewer)");
  });
});
