import { beforeEach, describe, expect, it, vi } from "vitest";

// editPost (actions/posts.ts): only a PUBLISHED post can be edited, so a held (FLAGGED) or REMOVED post can never be
// un-hidden by editing its caption, and the write itself is guarded on PUBLISHED. Audit H2 (2026-10-29).

const ME = "cme00000000001";
const POST = "cpost000000001";
const user = { id: ME, email: "me@example.com", isAdmin: false };
const postFindUnique = vi.fn();
const postUpdateMany = vi.fn();
const moderateText = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({ requireVerifiedUser: async () => user, requireViewer: async () => user }));
vi.mock("@/lib/translation-server", () => ({ deleteTranslationsOf: vi.fn() }));
vi.mock("@/lib/media-cleanup", () => ({ deleteMediaIfUnreferenced: vi.fn() }));
vi.mock("@/lib/moderation", () => ({ moderateText: (t: string) => moderateText(t) }));
vi.mock("@/lib/post-card-data", () => ({ postCardInclude: () => ({}), attachViewerState: vi.fn() }));
vi.mock("@/lib/post-visibility", () => ({ getVisiblePostsWhere: vi.fn(), LEAD_POST_ONLY: {} }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    post: {
      findUnique: (a: unknown) => postFindUnique(a),
      updateMany: (a: unknown) => postUpdateMany(a),
      update: () => {
        throw new Error("editPost must use the guarded updateMany");
      },
    },
  },
}));

const { editPost } = await import("@/app/actions/posts");

function form(content = "new caption") {
  const fd = new FormData();
  fd.set("content", content);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  moderateText.mockResolvedValue({ allowed: true, flaggedCategories: [] });
  postUpdateMany.mockResolvedValue({ count: 1 });
});

describe("editPost", () => {
  it("edits a published post with a write guarded on PUBLISHED", async () => {
    postFindUnique.mockResolvedValue({ id: POST, authorId: ME, moderationStatus: "PUBLISHED" });
    const result = await editPost(POST, form());
    expect(result.error).toBeNull();
    expect(postUpdateMany).toHaveBeenCalledWith({
      where: { id: POST, authorId: ME, moderationStatus: "PUBLISHED" },
      data: expect.objectContaining({ content: "new caption", moderationStatus: "PUBLISHED" }),
    });
  });

  it.each(["FLAGGED", "REMOVED"])("refuses to edit a %s post and writes nothing", async (status) => {
    postFindUnique.mockResolvedValue({ id: POST, authorId: ME, moderationStatus: status });
    const result = await editPost(POST, form());
    expect(result).toEqual({ error: "under_review" });
    expect(moderateText).not.toHaveBeenCalled();
    expect(postUpdateMany).not.toHaveBeenCalled();
  });

  it("a hold that lands between the read and the write wins (0 rows written)", async () => {
    postFindUnique.mockResolvedValue({ id: POST, authorId: ME, moderationStatus: "PUBLISHED" });
    postUpdateMany.mockResolvedValue({ count: 0 });
    expect(await editPost(POST, form())).toEqual({ error: "under_review" });
  });

  it("a flagged edit takes a published post out of view", async () => {
    postFindUnique.mockResolvedValue({ id: POST, authorId: ME, moderationStatus: "PUBLISHED" });
    moderateText.mockResolvedValue({ allowed: false, flaggedCategories: ["harassment"] });
    await editPost(POST, form());
    expect(postUpdateMany.mock.calls[0][0].data.moderationStatus).toBe("FLAGGED");
  });

  it("refuses someone else's post", async () => {
    postFindUnique.mockResolvedValue({ id: POST, authorId: "cother00000001", moderationStatus: "PUBLISHED" });
    expect(await editPost(POST, form())).toEqual({ error: "forbidden" });
  });
});

// A text-only post's colored background (src/lib/post-backgrounds.ts) can be set, changed or removed in the edit; a
// text edit alone leaves it as it is but must still fit it.
describe("editPost: colored backgrounds", () => {
  const textPost = (over: Record<string, unknown> = {}) => ({
    id: POST,
    authorId: ME,
    moderationStatus: "PUBLISHED",
    mediaType: "NONE",
    eventAt: null,
    repostOfId: null,
    sharedPostId: null,
    backgroundStyle: null,
    ...over,
  });
  function styledForm(content: string, backgroundStyle?: string) {
    const fd = form(content);
    if (backgroundStyle !== undefined) fd.set("backgroundStyle", backgroundStyle);
    return fd;
  }

  it("sets a background on a text post and returns it", async () => {
    postFindUnique.mockResolvedValue(textPost());
    const result = await editPost(POST, styledForm("hello", "aurora"));
    expect(result).toMatchObject({ error: null, post: { content: "hello", backgroundStyle: "aurora" } });
    expect(postUpdateMany.mock.calls[0][0].data).toMatchObject({ content: "hello", backgroundStyle: "aurora" });
  });

  it("removes the background with an empty value", async () => {
    postFindUnique.mockResolvedValue(textPost({ backgroundStyle: "sunset" }));
    const result = await editPost(POST, styledForm("hello", ""));
    expect(result).toMatchObject({ error: null, post: { backgroundStyle: null } });
    expect(postUpdateMany.mock.calls[0][0].data.backgroundStyle).toBeNull();
  });

  it("leaves the background alone when the field isn't sent", async () => {
    postFindUnique.mockResolvedValue(textPost({ backgroundStyle: "sunset" }));
    const result = await editPost(POST, styledForm("new words"));
    expect(result).toMatchObject({ error: null, post: { backgroundStyle: "sunset" } });
    expect(postUpdateMany.mock.calls[0][0].data).not.toHaveProperty("backgroundStyle");
  });

  it("refuses an unknown key", async () => {
    postFindUnique.mockResolvedValue(textPost());
    expect(await editPost(POST, styledForm("hello", "#ff00ff"))).toEqual({ error: "invalid" });
    expect(postUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses longer text than a styled post can hold, also on a text-only edit", async () => {
    postFindUnique.mockResolvedValue(textPost({ backgroundStyle: "sunset" }));
    expect(await editPost(POST, styledForm("x".repeat(221)))).toEqual({ error: "background_too_long" });
    expect(postUpdateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["a photo post", { mediaType: "IMAGE" }],
    ["an event", { eventAt: new Date("2030-01-01T10:00:00Z") }],
    ["a repost", { repostOfId: "cpost000000002" }],
    ["a share", { sharedPostId: "cpost000000002" }],
  ])("refuses a background on %s", async (_label, over) => {
    postFindUnique.mockResolvedValue(textPost(over));
    expect(await editPost(POST, styledForm("hello", "ocean"))).toEqual({ error: "background_not_allowed" });
    expect(postUpdateMany).not.toHaveBeenCalled();
  });
});

// A video's colored frame and a post's optional music (src/lib/post-music.ts) can be set, changed or removed in the
// edit, on the same posts createPost allows them on.
describe("editPost: video frames and music", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: POST,
    authorId: ME,
    moderationStatus: "PUBLISHED",
    mediaType: "VIDEO",
    eventAt: null,
    repostOfId: null,
    sharedPostId: null,
    albumId: null,
    albumIndex: null,
    backgroundStyle: null,
    musicTrack: null,
    ...over,
  });
  function editForm(content: string, fields: Record<string, string>) {
    const fd = form(content);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  }

  it("frames a video, with a caption longer than a styled text post may be", async () => {
    postFindUnique.mockResolvedValue(row());
    const result = await editPost(POST, editForm("y".repeat(600), { backgroundStyle: "neon" }));
    expect(result).toMatchObject({ error: null, post: { backgroundStyle: "neon" } });
  });

  it("refuses a frame on an embedded video", async () => {
    postFindUnique.mockResolvedValue(row({ mediaType: "EMBED" }));
    expect(await editPost(POST, editForm("hi", { backgroundStyle: "neon" }))).toEqual({ error: "background_not_allowed" });
  });

  it.each(["VIDEO", "IMAGE", "NONE"])("sets, changes and removes music on a %s post", async (mediaType) => {
    postFindUnique.mockResolvedValue(row({ mediaType }));
    expect(await editPost(POST, editForm("hello", { musicTrack: "groove" }))).toMatchObject({
      error: null,
      post: { musicTrack: "groove" },
    });
    expect(postUpdateMany.mock.calls[0][0].data.musicTrack).toBe("groove");
    postFindUnique.mockResolvedValue(row({ mediaType, musicTrack: "groove" }));
    expect(await editPost(POST, editForm("hello", { musicTrack: "" }))).toMatchObject({ post: { musicTrack: null } });
    expect(postUpdateMany.mock.calls[1][0].data.musicTrack).toBeNull();
  });

  it("leaves the music alone when the field isn't sent", async () => {
    postFindUnique.mockResolvedValue(row({ musicTrack: "focus" }));
    const result = await editPost(POST, editForm("new caption", {}));
    expect(result).toMatchObject({ post: { musicTrack: "focus" } });
    expect(postUpdateMany.mock.calls[0][0].data).not.toHaveProperty("musicTrack");
  });

  it.each([
    ["an embed", { mediaType: "EMBED" }],
    ["a link", { mediaType: "LINK" }],
    ["a GIF", { mediaType: "GIF" }],
    ["an event", { mediaType: "NONE", eventAt: new Date("2030-01-01T10:00:00Z") }],
    ["a repost", { repostOfId: "cpost000000002" }],
    ["a share", { sharedPostId: "cpost000000002" }],
    ["an album photo other than the lead", { mediaType: "IMAGE", albumId: "album-1", albumIndex: 2 }],
  ])("refuses music on %s", async (_label, over) => {
    postFindUnique.mockResolvedValue(row(over));
    expect(await editPost(POST, editForm("hello", { musicTrack: "island" }))).toEqual({ error: "music_not_allowed" });
    expect(postUpdateMany).not.toHaveBeenCalled();
  });

  it("allows music on an album's lead photo", async () => {
    postFindUnique.mockResolvedValue(row({ mediaType: "IMAGE", albumId: "album-1", albumIndex: 0 }));
    expect(await editPost(POST, editForm("hello", { musicTrack: "island" }))).toMatchObject({ error: null });
  });

  it.each(["https://example.com/a.mp3", "Sunrise", "__proto__"])("refuses a music value that isn't a key (%s)", async (bad) => {
    postFindUnique.mockResolvedValue(row());
    expect(await editPost(POST, editForm("hello", { musicTrack: bad }))).toEqual({ error: "invalid" });
    expect(postUpdateMany).not.toHaveBeenCalled();
  });
});
