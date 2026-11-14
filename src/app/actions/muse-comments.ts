"use server";

import { requireVerifiedUser, requireVerifiedViewer } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";
import { pushActivityNotification } from "@/lib/notify-push";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { isGiphyUrl } from "@/lib/giphy";
import {
  MUSE_COMMENTS_PAGE_SIZE,
  MUSE_COMMENT_GIF_URL_MAX,
  MUSE_COMMENT_MAX_LENGTH,
  MUSE_REPLIES_PAGE_SIZE,
  decodeMuseCommentCursor,
  museCommentHref,
  museCommentRecipients,
  newestFirstAfter,
  oldestFirstAfter,
  pageOf,
  resolveReplyTarget,
} from "@/lib/muse-comment-threads";
import {
  MUSE_COMMENT_SELECT,
  blockedIdsFor,
  museCommentVisibleWhere,
  museForComments,
  toMuseCommentViews,
} from "@/lib/muse-comments-data";

// A Muse's comments and their one level of replies. Every action re-derives the actor from the session and re-checks
// what that actor may see: the Muse (published, author not blocked either way) and each comment it touches
// (PUBLISHED, author ACTIVE, not blocked either way). Anything not visible answers `not_found`, never `forbidden`, so
// nothing reveals a block. Pure rules: src/lib/muse-comment-threads.ts; queries: src/lib/muse-comments-data.ts.
//
// No revalidatePath: /muse is rendered per request (it reads the session), and the sheet updates its own list and the
// card's count from each answer, so a router refresh would only re-fetch the page under a playing video.

type VisibilityRow = { authorId: string; moderationStatus: string; author: { status: string } };

function visibleTo(row: VisibilityRow, blockedIds: Set<string>) {
  return row.moderationStatus === "PUBLISHED" && row.author.status === "ACTIVE" && !blockedIds.has(row.authorId);
}

const TARGET_SELECT = {
  id: true,
  museId: true,
  parentId: true,
  authorId: true,
  moderationStatus: true,
  author: { select: { status: true } },
} as const;

/**
 * A comment the viewer acts on (replies to, likes, opens the thread of), with its thread's top-level comment, if the
 * viewer can see both. Null otherwise.
 */
async function visibleCommentAndRoot(commentId: string, viewerId: string, blockedIds: Set<string>, museId?: string) {
  const comment = await prisma.museComment.findUnique({ where: { id: commentId }, select: TARGET_SELECT });
  if (!comment || (museId && comment.museId !== museId) || !visibleTo(comment, blockedIds)) return null;
  const root = comment.parentId
    ? await prisma.museComment.findUnique({ where: { id: comment.parentId }, select: TARGET_SELECT })
    : comment;
  if (!root || root.parentId !== null || !visibleTo(root, blockedIds)) return null;
  const muse = await museForComments(comment.museId, viewerId);
  if (!muse) return null;
  return { comment, root, muse };
}

/** One page of a Muse's top-level comments, newest first, each with its exact visible reply count. */
export async function getMuseComments(museId: string, cursor?: string | null) {
  const user = await requireVerifiedViewer();
  if (!(await checkRateLimit("museCommentList", user.id))) {
    return { error: "rate_limited" as const, comments: [], nextCursor: null, viewer: null };
  }

  const muse = await museForComments(museId, user.id);
  if (!muse) return { error: "not_found" as const, comments: [], nextCursor: null, viewer: null };

  const blockedIds = await blockedIdsFor(user.id);
  const rows = await prisma.museComment.findMany({
    where: {
      museId,
      parentId: null,
      ...museCommentVisibleWhere(blockedIds),
      ...newestFirstAfter(decodeMuseCommentCursor(cursor)),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MUSE_COMMENTS_PAGE_SIZE + 1,
    select: MUSE_COMMENT_SELECT,
  });
  const { items, nextCursor } = pageOf(rows, MUSE_COMMENTS_PAGE_SIZE);
  const comments = await toMuseCommentViews(items, user.id, blockedIds);
  // The composer's own avatar: two fields copied out, never the session's User row.
  return { error: null, comments, nextCursor, viewer: { name: user.name, avatarUrl: user.avatarUrl } };
}

/** One page of a comment's replies, oldest first ("View N more replies"). */
export async function getMuseCommentReplies(commentId: string, cursor?: string | null) {
  const user = await requireVerifiedViewer();
  if (!(await checkRateLimit("museCommentList", user.id))) {
    return { error: "rate_limited" as const, replies: [], nextCursor: null };
  }

  const blockedIds = await blockedIdsFor(user.id);
  const found = await visibleCommentAndRoot(commentId, user.id, blockedIds);
  // Only a top-level comment has replies to list.
  if (!found || found.comment.parentId !== null) return { error: "not_found" as const, replies: [], nextCursor: null };

  const rows = await prisma.museComment.findMany({
    where: {
      parentId: commentId,
      ...museCommentVisibleWhere(blockedIds),
      ...oldestFirstAfter(decodeMuseCommentCursor(cursor)),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MUSE_REPLIES_PAGE_SIZE + 1,
    select: MUSE_COMMENT_SELECT,
  });
  const { items, nextCursor } = pageOf(rows, MUSE_REPLIES_PAGE_SIZE);
  return { error: null, replies: await toMuseCommentViews(items, user.id, blockedIds), nextCursor };
}

/**
 * The thread a notification points at (`/muse/<id>?comment=<commentId>`): its top-level comment and the first page of
 * replies, so the sheet can open with that thread on top. `commentId` may be a reply.
 */
export async function getMuseCommentThread(museId: string, commentId: string) {
  const user = await requireVerifiedViewer();
  if (!(await checkRateLimit("museCommentList", user.id))) return { error: "rate_limited" as const, thread: null };

  const blockedIds = await blockedIdsFor(user.id);
  const found = await visibleCommentAndRoot(commentId, user.id, blockedIds, museId);
  if (!found) return { error: "not_found" as const, thread: null };

  const [rootRows, replyRows] = await Promise.all([
    prisma.museComment.findMany({ where: { id: found.root.id }, select: MUSE_COMMENT_SELECT }),
    prisma.museComment.findMany({
      where: { parentId: found.root.id, ...museCommentVisibleWhere(blockedIds) },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: MUSE_REPLIES_PAGE_SIZE + 1,
      select: MUSE_COMMENT_SELECT,
    }),
  ]);
  const { items, nextCursor } = pageOf(replyRows, MUSE_REPLIES_PAGE_SIZE);
  const views = await toMuseCommentViews([...rootRows, ...items], user.id, blockedIds);
  const [comment, ...replies] = views;
  if (!comment) return { error: "not_found" as const, thread: null };
  return { error: null, thread: { comment, replies, nextCursor } };
}

class ParentGoneError extends Error {}

/**
 * Posts a comment, or a reply when `replyToId` is set (FormData: `content`, optional `gifUrl`, optional `replyToId`).
 * A comment is text, a GIF or both. The GIF is never an upload of ours: only an https URL on a Giphy host passes
 * (isGiphyUrl, the same check as post comments and chat GIFs), so no arbitrary URL is ever stored or rendered. A reply always
 * attaches to a top-level comment: replying to a reply joins that reply's thread (resolveReplyTarget), and its author
 * is the one notified. Text goes through the same moderation as every comment: flagged text is stored FLAGGED, never
 * shown or counted, and notifies nobody. Muse.commentCount (replies included) changes in the same transaction as the
 * insert, and a reply first locks its parent row, so a reply racing the parent's deletion either lands before it (and
 * is counted off with it) or fails (and is never counted).
 */
export async function createMuseComment(museId: string, formData: FormData) {
  const user = await requireVerifiedUser();

  if (!(await checkRateLimit("comment", user.id))) {
    return { error: "rate_limited" as const };
  }

  const muse = await museForComments(museId, user.id);
  if (!muse) return { error: "not_found" as const };

  const content = String(formData.get("content") ?? "").trim();
  const rawGif = formData.get("gifUrl");
  const gifUrl = typeof rawGif === "string" && rawGif.trim() ? rawGif.trim() : null;
  if (content.length > MUSE_COMMENT_MAX_LENGTH || (!content && !gifUrl)) {
    return { error: "invalid" as const };
  }
  if (gifUrl && (gifUrl.length > MUSE_COMMENT_GIF_URL_MAX || !isGiphyUrl(gifUrl))) {
    return { error: "invalid" as const };
  }

  const replyToId = formData.get("replyToId");
  let parentId: string | null = null;
  let replyToAuthorId: string | null = null;
  if (typeof replyToId === "string" && replyToId) {
    const blockedIds = await blockedIdsFor(user.id);
    const found = await visibleCommentAndRoot(replyToId, user.id, blockedIds, museId);
    if (!found) return { error: "not_found" as const };
    const target = resolveReplyTarget(found.comment);
    parentId = target.parentId;
    replyToAuthorId = target.notifyUserId;
  }

  // Any text is moderated like every comment; a GIF alone has nothing of ours to check (Giphy's catalog is
  // pre-moderated, the same reasoning as post comments and chat GIFs).
  const modResult = content ? await moderateText(content) : { allowed: true };
  const moderationStatus = modResult.allowed ? ("PUBLISHED" as const) : ("FLAGGED" as const);

  let created;
  let commentCount: number | null = null;
  try {
    ({ created, commentCount } = await prisma.$transaction(async (tx) => {
      if (parentId) {
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "MuseComment" WHERE "id" = ${parentId} FOR UPDATE`;
        if (locked.length === 0) throw new ParentGoneError();
      }
      const row = await tx.museComment.create({
        data: { museId, authorId: user.id, parentId, content, gifUrl, moderationStatus },
        select: MUSE_COMMENT_SELECT,
      });
      if (moderationStatus !== "PUBLISHED") return { created: row, commentCount: null };
      const updated = await tx.muse.update({
        where: { id: museId },
        data: { commentCount: { increment: 1 } },
        select: { commentCount: true },
      });
      return { created: row, commentCount: updated.commentCount };
    }));
  } catch (err) {
    if (err instanceof ParentGoneError) return { error: "not_found" as const };
    throw err;
  }

  if (moderationStatus === "PUBLISHED") {
    const recipients = museCommentRecipients({ actorId: user.id, museAuthorId: muse.authorId, replyToAuthorId });
    const url = museCommentHref(museId, created.id);
    if (recipients.reply) {
      await prisma.notification.create({
        data: { recipientId: recipients.reply, actorId: user.id, type: "COMMENT_REPLY", museId, museCommentId: created.id },
      });
      await pushActivityNotification(recipients.reply, "COMMENT_REPLY", user.name, url);
    }
    if (recipients.muse) {
      await prisma.notification.create({
        data: { recipientId: recipients.muse, actorId: user.id, type: "MUSE_COMMENT", museId, museCommentId: created.id },
      });
      await pushActivityNotification(recipients.muse, "MUSE_COMMENT", user.name, url);
    }
  }

  return {
    error: null,
    moderationStatus,
    commentCount,
    comment: {
      id: created.id,
      parentId: created.parentId,
      content: created.content,
      gifUrl: created.gifUrl,
      createdAt: created.createdAt,
      author: created.author,
      likeCount: 0,
      likedByMe: false,
      replyCount: 0,
    },
  };
}

/**
 * The comment's author, the Muse's author or a site admin removes a comment or reply. Removing a top-level comment
 * removes its replies with it (cascade), and Muse.commentCount loses every PUBLISHED one of them, counted inside the
 * transaction after locking the thread's top-level row (the same lock a new reply takes), so a reply posted or deleted
 * at the same moment is counted exactly once.
 */
export async function deleteMuseComment(commentId: string) {
  const user = await requireVerifiedUser();

  const comment = await prisma.museComment.findUnique({
    where: { id: commentId },
    select: { id: true, museId: true, parentId: true, authorId: true, muse: { select: { authorId: true } } },
  });
  if (!comment) return { error: "not_found" as const };
  if (comment.authorId !== user.id && comment.muse.authorId !== user.id && !user.isAdmin) {
    return { error: "forbidden" as const };
  }

  const result = await prisma.$transaction(async (tx) => {
    // Parent first, then the reply: the same order a new reply locks in, so the two never deadlock.
    if (comment.parentId) {
      await tx.$queryRaw`SELECT "id" FROM "MuseComment" WHERE "id" = ${comment.parentId} FOR UPDATE`;
    }
    const locked = await tx.$queryRaw<{ id: string; moderationStatus: string }[]>`
      SELECT "id", "moderationStatus"::text AS "moderationStatus" FROM "MuseComment" WHERE "id" = ${commentId} FOR UPDATE`;
    // Already deleted by someone else (or with its parent): nothing left to count off.
    if (locked.length === 0) return { deleted: false as const, commentCount: null };
    const repliesPublished = comment.parentId
      ? 0
      : await tx.museComment.count({ where: { parentId: commentId, moderationStatus: "PUBLISHED" } });
    await tx.museComment.delete({ where: { id: commentId } });
    const removed = (locked[0].moderationStatus === "PUBLISHED" ? 1 : 0) + repliesPublished;
    if (removed === 0) return { deleted: true as const, commentCount: null };
    const updated = await tx.muse.update({
      where: { id: comment.museId },
      data: { commentCount: { decrement: removed } },
      select: { commentCount: true },
    });
    return { deleted: true as const, commentCount: Math.max(0, updated.commentCount) };
  });
  if (!result.deleted) return { error: "not_found" as const };
  return { error: null, commentCount: result.commentCount };
}

/** Likes or unlikes a comment or reply the viewer can see. Answers the new state and the exact like count. */
export async function toggleMuseCommentLike(commentId: string) {
  const user = await requireVerifiedUser();

  if (!(await checkRateLimit("like", user.id))) {
    return { error: "rate_limited" as const };
  }

  const blockedIds = await blockedIdsFor(user.id);
  const found = await visibleCommentAndRoot(commentId, user.id, blockedIds);
  if (!found) return { error: "not_found" as const };

  const existing = await prisma.museCommentLike.findUnique({
    where: { commentId_userId: { commentId, userId: user.id } },
    select: { id: true },
  });
  let liked: boolean;
  if (existing) {
    await prisma.museCommentLike.deleteMany({ where: { commentId, userId: user.id } });
    liked = false;
  } else {
    try {
      await prisma.museCommentLike.create({ data: { commentId, userId: user.id } });
    } catch (err) {
      // A double tap raced past the check: the like exists, which is what was asked for.
      if (!isUniqueConstraintError(err)) throw err;
    }
    liked = true;
  }
  const likeCount = await prisma.museCommentLike.count({ where: { commentId } });
  return { error: null, liked, likeCount };
}
