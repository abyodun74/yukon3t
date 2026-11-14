import { describe, expect, it } from "vitest";
import {
  addOwnReply,
  appendThreads,
  decodeMuseCommentCursor,
  encodeMuseCommentCursor,
  mentionPrefill,
  mergeReplyPage,
  museCommentHref,
  museCommentRecipients,
  needsReplyFetch,
  newestFirstAfter,
  oldestFirstAfter,
  pageOf,
  parseFocusCommentId,
  prependThread,
  removeFromThreads,
  resolveReplyTarget,
  setLiked,
  setThreadExpanded,
  threadOf,
  threadToggle,
  withoutMentionPrefill,
  type MuseCommentView,
} from "@/lib/muse-comment-threads";

const at = (s: number) => new Date(Date.UTC(2026, 10, 13, 10, 0, s));
function view(id: string, overrides: Partial<MuseCommentView> = {}): MuseCommentView {
  return {
    id,
    parentId: null,
    content: id,
    gifUrl: null,
    createdAt: at(0),
    author: { id: "u1", name: "Ada", username: "ada", avatarUrl: null },
    likeCount: 0,
    likedByMe: false,
    replyCount: 0,
    ...overrides,
  };
}

describe("cursors", () => {
  it("round-trips (createdAt, id) and rejects anything else", () => {
    const row = { createdAt: at(5), id: "cabc12345678" };
    expect(decodeMuseCommentCursor(encodeMuseCommentCursor(row))).toEqual(row);
    for (const bad of [null, 42, "", "nope", "2026-11-13T10:00:05.000Z_", "_cabc12345678", "2026-13-99T10:00:05.000Z_cabc12345678", `2026-11-13T10:00:05.000Z_${"a".repeat(60)}`, "2026-11-13T10:00:05.000Z_ab;drop"]) {
      expect(decodeMuseCommentCursor(bad), String(bad)).toBeNull();
    }
  });

  it("builds strict 'after' filters in both directions, nothing for the first page", () => {
    const c = { createdAt: at(5), id: "cabc12345678" };
    expect(newestFirstAfter(null)).toEqual({});
    expect(oldestFirstAfter(null)).toEqual({});
    expect(newestFirstAfter(c)).toEqual({ OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] });
    expect(oldestFirstAfter(c)).toEqual({ OR: [{ createdAt: { gt: c.createdAt } }, { createdAt: c.createdAt, id: { gt: c.id } }] });
  });

  it("gives a page a cursor only when a row past it was fetched", () => {
    const rows = [1, 2, 3].map((n) => ({ id: `c${n}000000000`, createdAt: at(n) }));
    expect(pageOf(rows, 3)).toEqual({ items: rows, nextCursor: null });
    expect(pageOf(rows, 2)).toEqual({ items: rows.slice(0, 2), nextCursor: encodeMuseCommentCursor(rows[1]) });
    expect(pageOf([], 2)).toEqual({ items: [], nextCursor: null });
  });
});

describe("replying", () => {
  it("attaches a reply to a top-level comment under it, and a reply to a reply to the same thread", () => {
    expect(resolveReplyTarget({ id: "top", parentId: null, authorId: "a" })).toEqual({ parentId: "top", notifyUserId: "a" });
    expect(resolveReplyTarget({ id: "r1", parentId: "top", authorId: "b" })).toEqual({ parentId: "top", notifyUserId: "b" });
  });

  it("prefills an @mention of the person replied to, only for a real username", () => {
    expect(mentionPrefill({ username: "ada_l" })).toBe("@ada_l ");
    expect(mentionPrefill({ username: null })).toBe("");
    expect(mentionPrefill({ username: "  " })).toBe("");
    expect(mentionPrefill({ username: "bad name" })).toBe("");
    expect(withoutMentionPrefill("@ada_l hello", "@ada_l ")).toBe("hello");
    expect(withoutMentionPrefill("hello", "@ada_l ")).toBe("hello");
    expect(withoutMentionPrefill("hello", "")).toBe("hello");
  });

  it("notifies the person answered and the Muse's owner, each once, never the writer", () => {
    expect(museCommentRecipients({ actorId: "me", museAuthorId: "owner", replyToAuthorId: null })).toEqual({ reply: null, muse: "owner" });
    expect(museCommentRecipients({ actorId: "me", museAuthorId: "owner", replyToAuthorId: "bob" })).toEqual({ reply: "bob", muse: "owner" });
    expect(museCommentRecipients({ actorId: "me", museAuthorId: "owner", replyToAuthorId: "owner" })).toEqual({ reply: "owner", muse: null });
    expect(museCommentRecipients({ actorId: "me", museAuthorId: "owner", replyToAuthorId: "me" })).toEqual({ reply: null, muse: "owner" });
    expect(museCommentRecipients({ actorId: "owner", museAuthorId: "owner", replyToAuthorId: "owner" })).toEqual({ reply: null, muse: null });
  });

  it("links a notification to the Muse with its comments open on the thread", () => {
    expect(museCommentHref("m1", "c1")).toBe("/muse/m1?comment=c1");
    expect(museCommentHref("m1", null)).toBe("/muse/m1");
    expect(parseFocusCommentId("cabc12345678")).toBe("cabc12345678");
    expect(parseFocusCommentId(["cabc12345678", "x"])).toBe("cabc12345678");
    for (const bad of [undefined, "", "a b", "<script>", "x".repeat(60)]) expect(parseFocusCommentId(bad)).toBeNull();
  });
});

describe("the thread list", () => {
  it("appends a page without repeating a pinned or just-posted thread", () => {
    const threads = [threadOf(view("pinned")), threadOf(view("mine"))];
    const next = appendThreads(threads, [view("mine"), view("a"), view("pinned"), view("b")]);
    expect(next.map((t) => t.comment.id)).toEqual(["pinned", "mine", "a", "b"]);
  });

  it("puts a new comment on top, under a pinned deep-link thread", () => {
    const threads = [threadOf(view("pinned")), threadOf(view("a"))];
    expect(prependThread(threads, view("new"), "pinned").map((t) => t.comment.id)).toEqual(["pinned", "new", "a"]);
    expect(prependThread(threads, view("new")).map((t) => t.comment.id)).toEqual(["new", "pinned", "a"]);
  });

  it("puts my reply at the end of its thread, opens it and counts it", () => {
    const threads = [threadOf(view("top", { replyCount: 3 }))];
    const next = addOwnReply(threads, view("mine", { parentId: "top", createdAt: at(30) }));
    expect(next[0].replies.map((r) => r.id)).toEqual(["mine"]);
    expect(next[0].expanded).toBe(true);
    expect(next[0].comment.replyCount).toBe(4);
    // Not twice.
    expect(addOwnReply(next, view("mine", { parentId: "top" }))[0].comment.replyCount).toBe(4);
    // The 3 others still to fetch.
    expect(threadToggle(next[0])).toEqual({ kind: "view-more", count: 3 });
    expect(needsReplyFetch(next[0])).toBe(true);
  });

  it("merges reply pages oldest first, without duplicates, even around my own reply", () => {
    let threads = addOwnReply([threadOf(view("top", { replyCount: 2 }))], view("mine", { parentId: "top", createdAt: at(30) }));
    threads = mergeReplyPage(threads, "top", [view("r1", { parentId: "top", createdAt: at(10) }), view("mine", { parentId: "top", createdAt: at(30) }), view("r2", { parentId: "top", createdAt: at(20) })], null);
    expect(threads[0].replies.map((r) => r.id)).toEqual(["r1", "r2", "mine"]);
    expect(threadToggle(threads[0])).toEqual({ kind: "hide", count: 3 });
    expect(needsReplyFetch(threads[0])).toBe(false);
  });

  it("walks a thread's toggle: view all, view more, hide, view all again without refetching", () => {
    let threads = [threadOf(view("top", { replyCount: 12 }))];
    expect(threadToggle(threads[0])).toEqual({ kind: "view-all", count: 12 });
    expect(needsReplyFetch(threads[0])).toBe(true);
    const page1 = Array.from({ length: 10 }, (_, i) => view(`r${i}`, { parentId: "top", createdAt: at(i + 1) }));
    threads = mergeReplyPage(threads, "top", page1, "cursor");
    expect(threadToggle(threads[0])).toEqual({ kind: "view-more", count: 2 });
    threads = mergeReplyPage(threads, "top", [view("r10", { parentId: "top", createdAt: at(20) }), view("r11", { parentId: "top", createdAt: at(21) })], null);
    expect(threadToggle(threads[0])).toEqual({ kind: "hide", count: 12 });
    threads = setThreadExpanded(threads, "top", false);
    expect(threadToggle(threads[0])).toEqual({ kind: "view-all", count: 12 });
    expect(threads[0].repliesFetched).toBe(true);
    expect(threadToggle(threadOf(view("lonely")))).toEqual({ kind: "none", count: 0 });
  });

  it("removes a whole thread, or one reply with its count", () => {
    let threads = mergeReplyPage([threadOf(view("top", { replyCount: 2 })), threadOf(view("b"))], "top", [view("r1", { parentId: "top" }), view("r2", { parentId: "top", createdAt: at(1) })], null);
    threads = removeFromThreads(threads, "r1");
    expect(threads[0].replies.map((r) => r.id)).toEqual(["r2"]);
    expect(threads[0].comment.replyCount).toBe(1);
    expect(removeFromThreads(threads, "top").map((t) => t.comment.id)).toEqual(["b"]);
  });

  it("sets a like wherever the comment is", () => {
    const threads = mergeReplyPage([threadOf(view("top"))], "top", [view("r1", { parentId: "top" })], null);
    const next = setLiked(threads, "r1", true, 5);
    expect(next[0].replies[0]).toMatchObject({ likedByMe: true, likeCount: 5 });
    expect(next[0].comment.likedByMe).toBe(false);
  });
});
