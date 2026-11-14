// Muse comments with one level of replies: the pure, client-safe rules (no Prisma, no React). The server half is
// src/lib/muse-comments-data.ts, the actions actions/muse-comments.ts, the sheet components/muse-comments-sheet.tsx.

/** Top-level comments per page (newest first). */
export const MUSE_COMMENTS_PAGE_SIZE = 20;
/** Replies per page under one comment (oldest first, so a thread reads top to bottom). */
export const MUSE_REPLIES_PAGE_SIZE = 10;
/** Same cap the comment composer has always had. */
export const MUSE_COMMENT_MAX_LENGTH = 1000;
/** Longest GIF URL accepted (Giphy's own are well under this). */
export const MUSE_COMMENT_GIF_URL_MAX = 2048;
/** The quick-emoji row above the composer: a tap adds the emoji to the comment being written. */
export const MUSE_COMMENT_QUICK_EMOJI = ["❤️", "🙌", "🔥", "👏", "😢", "😍", "😮", "😂"] as const;

export type MuseCommentAuthor = { id: string; name: string | null; username: string | null; avatarUrl: string | null };

/** One comment or reply as the browser gets it. Counts are exact for this viewer (counted at read time). */
export type MuseCommentView = {
  id: string;
  parentId: string | null;
  /** Empty for a GIF-only comment. */
  content: string;
  /** A Giphy GIF (validated server-side with isGiphyUrl), or null. */
  gifUrl: string | null;
  createdAt: Date;
  author: MuseCommentAuthor;
  likeCount: number;
  likedByMe: boolean;
  /** Top-level comments only: replies this viewer can see. Always 0 on a reply. */
  replyCount: number;
};

// ---------------------------------------------------------------------------------------------------------------
// Cursors: (createdAt, id), so two comments in the same millisecond never repeat or skip across pages.

export type MuseCommentCursor = { createdAt: Date; id: string };

export function encodeMuseCommentCursor(row: { createdAt: Date; id: string }): string {
  return `${row.createdAt.toISOString()}_${row.id}`;
}

/** null for anything that isn't a cursor this file made (a tampered or truncated value is treated as "first page"). */
export function decodeMuseCommentCursor(value: unknown): MuseCommentCursor | null {
  if (typeof value !== "string" || value.length > 80) return null;
  const at = value.indexOf("_");
  if (at <= 0) return null;
  const iso = value.slice(0, at);
  const id = value.slice(at + 1);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(iso) || !/^[a-z0-9]{8,40}$/i.test(id)) return null;
  const createdAt = new Date(iso);
  return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id };
}

/** Rows strictly after `cursor` in a newest-first list (top-level comments). */
export function newestFirstAfter(cursor: MuseCommentCursor | null) {
  if (!cursor) return {};
  return {
    OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }],
  };
}

/** Rows strictly after `cursor` in an oldest-first list (a thread's replies). */
export function oldestFirstAfter(cursor: MuseCommentCursor | null) {
  if (!cursor) return {};
  return {
    OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }],
  };
}

/** A page fetched with `take: size + 1`: the first `size` rows, and a cursor only when there really is more. */
export function pageOf<T extends { createdAt: Date; id: string }>(rows: T[], size: number) {
  const items = rows.slice(0, size);
  const nextCursor = rows.length > size && items.length > 0 ? encodeMuseCommentCursor(items[items.length - 1]) : null;
  return { items, nextCursor };
}

// ---------------------------------------------------------------------------------------------------------------
// Replying

/**
 * Where a reply goes: always under a top-level comment. Replying to a reply attaches to that reply's thread (one level
 * of threading), and the person replied to is the one notified.
 */
export function resolveReplyTarget(target: { id: string; parentId: string | null; authorId: string }) {
  return { parentId: target.parentId ?? target.id, notifyUserId: target.authorId };
}

/** The "@username " the composer starts with when replying; empty for an account without a username. */
export function mentionPrefill(author: { username: string | null }): string {
  const handle = author.username?.trim();
  return handle && /^[\w.]+$/.test(handle) ? `@${handle} ` : "";
}

/** The composer text once a reply is cancelled: the prefilled mention goes, anything typed after it stays. */
export function withoutMentionPrefill(text: string, prefill: string): string {
  return prefill && text.startsWith(prefill) ? text.slice(prefill.length) : text;
}

/** Who should hear about a new comment or reply: never the writer, and the Muse's owner only once. */
export function museCommentRecipients({
  actorId,
  museAuthorId,
  replyToAuthorId,
}: {
  actorId: string;
  museAuthorId: string;
  /** The author of the comment or reply being answered; null for a top-level comment. */
  replyToAuthorId: string | null;
}): { reply: string | null; muse: string | null } {
  const reply = replyToAuthorId && replyToAuthorId !== actorId ? replyToAuthorId : null;
  const muse = museAuthorId !== actorId && museAuthorId !== reply ? museAuthorId : null;
  return { reply, muse };
}

/** Where a Muse comment / reply notification leads: the Muse, with its comments open on that thread. */
export function museCommentHref(museId: string, commentId: string | null | undefined): string {
  return commentId ? `/muse/${museId}?comment=${encodeURIComponent(commentId)}` : `/muse/${museId}`;
}

/** The `?comment=` value of a deep link, if it looks like an id. */
export function parseFocusCommentId(value: unknown): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" && /^[a-z0-9]{8,40}$/i.test(v) ? v : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The sheet's list: threads (a top-level comment and the replies loaded under it)

export type MuseThread = {
  comment: MuseCommentView;
  replies: MuseCommentView[];
  /** Where the next page of replies starts; null once every reply has been fetched (or none has been asked for yet). */
  repliesCursor: string | null;
  /** True once a page of replies has been fetched. */
  repliesFetched: boolean;
  expanded: boolean;
};

export function threadOf(comment: MuseCommentView, replies: MuseCommentView[] = [], repliesCursor: string | null = null): MuseThread {
  return {
    comment,
    replies: sortReplies(dedupeById(replies)),
    repliesCursor,
    repliesFetched: replies.length > 0 || repliesCursor !== null,
    expanded: replies.length > 0,
  };
}

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

/** Oldest first, ties by id (the server's order). */
function sortReplies(rows: MuseCommentView[]): MuseCommentView[] {
  return [...rows].sort((a, b) => {
    const d = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Appends a fetched page of top-level comments, skipping any already shown (a pinned thread, one just posted). */
export function appendThreads(threads: MuseThread[], page: MuseCommentView[]): MuseThread[] {
  const shown = new Set(threads.map((t) => t.comment.id));
  return [...threads, ...page.filter((c) => !shown.has(c.id)).map((c) => threadOf(c))];
}

/** A comment the viewer just posted goes on top (newest first). A pinned deep-link thread stays first. */
export function prependThread(threads: MuseThread[], comment: MuseCommentView, pinnedId: string | null = null): MuseThread[] {
  const rest = threads.filter((t) => t.comment.id !== comment.id);
  if (pinnedId && rest[0]?.comment.id === pinnedId) return [rest[0], threadOf(comment), ...rest.slice(1)];
  return [threadOf(comment), ...rest];
}

/** A fetched page of one thread's replies: merged in order, deduplicated, the thread opened. */
export function mergeReplyPage(threads: MuseThread[], parentId: string, page: MuseCommentView[], nextCursor: string | null): MuseThread[] {
  return threads.map((t) =>
    t.comment.id === parentId
      ? {
          ...t,
          replies: sortReplies(dedupeById([...t.replies, ...page])),
          repliesCursor: nextCursor,
          repliesFetched: true,
          expanded: true,
        }
      : t,
  );
}

/** A reply the viewer just posted: at the end of its thread, which opens, and the thread's count goes up by one. */
export function addOwnReply(threads: MuseThread[], reply: MuseCommentView): MuseThread[] {
  if (!reply.parentId) return threads;
  return threads.map((t) =>
    t.comment.id === reply.parentId && !t.replies.some((r) => r.id === reply.id)
      ? {
          ...t,
          comment: { ...t.comment, replyCount: t.comment.replyCount + 1 },
          replies: [...t.replies, reply],
          expanded: true,
        }
      : t,
  );
}

/** Removes a comment (with its whole thread) or a single reply (its thread's count goes down by one). */
export function removeFromThreads(threads: MuseThread[], id: string): MuseThread[] {
  return threads
    .filter((t) => t.comment.id !== id)
    .map((t) =>
      t.replies.some((r) => r.id === id)
        ? {
            ...t,
            comment: { ...t.comment, replyCount: Math.max(0, t.comment.replyCount - 1) },
            replies: t.replies.filter((r) => r.id !== id),
          }
        : t,
    );
}

export function setThreadExpanded(threads: MuseThread[], parentId: string, expanded: boolean): MuseThread[] {
  return threads.map((t) => (t.comment.id === parentId ? { ...t, expanded } : t));
}

/** Like toggled on a comment or a reply, wherever it is in the list. */
export function setLiked(threads: MuseThread[], id: string, liked: boolean, likeCount: number): MuseThread[] {
  const apply = (c: MuseCommentView) => (c.id === id ? { ...c, likedByMe: liked, likeCount } : c);
  return threads.map((t) => ({ ...t, comment: apply(t.comment), replies: t.replies.map(apply) }));
}

/**
 * What the thread's toggle row says. `view-all`: collapsed with replies to show ("View N replies"); `view-more`:
 * expanded with more to fetch ("View N more replies"); `hide`: everything is shown ("Hide replies"); `none`: no row.
 */
export function threadToggle(thread: MuseThread): { kind: "view-all" | "view-more" | "hide" | "none"; count: number } {
  const total = Math.max(thread.comment.replyCount, thread.replies.length);
  if (total === 0) return { kind: "none", count: 0 };
  if (!thread.expanded) return { kind: "view-all", count: total };
  const remaining = Math.max(0, total - thread.replies.length);
  if (remaining > 0 && (thread.repliesCursor !== null || !thread.repliesFetched)) return { kind: "view-more", count: remaining };
  return { kind: "hide", count: total };
}

/** A collapsed thread whose replies were never fetched needs a fetch to open; a fetched one just opens. */
export function needsReplyFetch(thread: MuseThread): boolean {
  const total = Math.max(thread.comment.replyCount, thread.replies.length);
  if (total === 0) return false;
  if (!thread.repliesFetched) return true;
  return thread.expanded && thread.repliesCursor !== null;
}
