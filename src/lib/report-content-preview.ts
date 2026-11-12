import { prisma } from "@/lib/prisma";
import { isEncryptedContent } from "@/lib/e2ee/constants";
import { embedPublicUrl } from "@/lib/video-embed";
import type { ReportTargetType } from "@/lib/report-target";

// What the moderation queue shows for each open report: the reported thing itself (its text, a media preview, a
// link), read from the database as it is now, so a moderator decides on the evidence rather than on the reporter's
// description of it. Admin-only (src/app/admin/moderation/page.tsx); server-rendered, never sent to a client
// component.

const TEXT_PREVIEW_MAX = 1000;

export type ReportedContent = {
  /** False once the target is gone (deleted by its author, removed by moderation, account deleted). */
  exists: boolean;
  /** Who the content is by, as it is now (author/sender/creator, or the profile itself). */
  author: { id: string; name: string | null; username: string | null; status: string } | null;
  /** Caption, comment, message text, bio or description; capped. */
  text: string | null;
  /** Why there's no readable text, or something else the moderator should know about it. */
  notes: string[];
  /** A thumbnail to show inline. */
  imageUrl: string | null;
  /** e.g. "IMAGE (3 photos)", "VIDEO", "GIF". */
  mediaLabel: string | null;
  /** Direct links to the media files / external link. */
  links: { label: string; href: string }[];
  /** Where the moderator can open it in the app, if anywhere. */
  href: string | null;
};

type ReportRef = { targetType: ReportTargetType; targetId: string };

const authorSelect = { select: { id: true, name: true, username: true, status: true } } as const;

function cap(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.length > TEXT_PREVIEW_MAX ? `${text.slice(0, TEXT_PREVIEW_MAX)}…` : text;
}

function gone(): ReportedContent {
  return { exists: false, author: null, text: null, notes: [], imageUrl: null, mediaLabel: null, links: [], href: null };
}

/** Key for the map loadReportedContent returns. */
export function reportedContentKey(ref: ReportRef): string {
  return `${ref.targetType}:${ref.targetId}`;
}

/**
 * Loads every report's target in one query per target type. `run` wraps each query (the page's shared concurrency
 * limit). Targets that no longer exist get `exists: false`.
 */
export async function loadReportedContent(
  reports: ReportRef[],
  run: <T>(load: () => Promise<T>) => Promise<T> = (load) => load(),
): Promise<Map<string, ReportedContent>> {
  const idsOf = (type: ReportTargetType) => [
    ...new Set(reports.filter((r) => r.targetType === type).map((r) => r.targetId)),
  ];
  const postIds = idsOf("POST");
  const commentIds = idsOf("COMMENT");
  const messageIds = idsOf("MESSAGE");
  const circleIds = idsOf("CIRCLE");
  const collabIds = idsOf("COLLAB_POST");
  const userIds = idsOf("USER");

  const [posts, comments, messages, circles, collabs, users] = await Promise.all([
    postIds.length
      ? run(() =>
          prisma.post.findMany({
            where: { id: { in: postIds } },
            select: {
              id: true,
              content: true,
              mediaType: true,
              mediaUrls: true,
              videoUrl: true,
              videoThumbnailUrl: true,
              embedProvider: true,
              embedId: true,
              linkUrl: true,
              albumId: true,
              moderationStatus: true,
              author: authorSelect,
            },
          }),
        )
      : [],
    commentIds.length
      ? run(() =>
          prisma.comment.findMany({
            where: { id: { in: commentIds } },
            select: {
              id: true,
              postId: true,
              content: true,
              gifUrl: true,
              audioUrl: true,
              videoUrl: true,
              videoThumbnailUrl: true,
              moderationStatus: true,
              author: authorSelect,
            },
          }),
        )
      : [],
    messageIds.length
      ? run(() =>
          prisma.message.findMany({
            where: { id: { in: messageIds } },
            // Never viewOnceMedia: the view-once key must not reach any page.
            select: {
              id: true,
              content: true,
              mediaType: true,
              mediaUrl: true,
              mediaThumbnailUrl: true,
              viewOnce: true,
              deletedForEveryoneAt: true,
              moderationStatus: true,
              sender: authorSelect,
            },
          }),
        )
      : [],
    circleIds.length
      ? run(() =>
          prisma.circle.findMany({
            where: { id: { in: circleIds } },
            select: { id: true, name: true, slug: true, description: true, visibility: true, createdBy: authorSelect },
          }),
        )
      : [],
    collabIds.length
      ? run(() =>
          prisma.collabBoardPost.findMany({
            where: { id: { in: collabIds } },
            select: { id: true, title: true, description: true, status: true, author: authorSelect },
          }),
        )
      : [],
    userIds.length
      ? run(() =>
          prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, username: true, status: true, bio: true, avatarUrl: true },
          }),
        )
      : [],
  ]);

  const out = new Map<string, ReportedContent>();
  for (const ref of reports) out.set(reportedContentKey(ref), gone());

  for (const post of posts) {
    const notes: string[] = [];
    if (post.moderationStatus !== "PUBLISHED") notes.push(`Moderation status: ${post.moderationStatus}`);
    const links: ReportedContent["links"] = post.mediaUrls.map((url, i) => ({
      label: post.mediaUrls.length > 1 ? `Photo ${i + 1}` : post.mediaType === "GIF" ? "GIF" : "Photo",
      href: url,
    }));
    if (post.videoUrl) links.push({ label: "Video", href: post.videoUrl });
    if (post.embedProvider && post.embedId) {
      links.push({ label: `${post.embedProvider} video`, href: embedPublicUrl({ provider: post.embedProvider, id: post.embedId }) });
    }
    if (post.linkUrl) links.push({ label: "Linked page", href: post.linkUrl });
    out.set(reportedContentKey({ targetType: "POST", targetId: post.id }), {
      exists: true,
      author: post.author,
      text: cap(post.content),
      notes,
      imageUrl: post.mediaType === "VIDEO" ? post.videoThumbnailUrl : (post.mediaUrls[0] ?? null),
      mediaLabel:
        post.mediaType === "NONE" ? null : `${post.mediaType}${post.albumId ? " (part of a multi-photo post)" : ""}`,
      links,
      href: `/post/${post.id}`,
    });
  }

  for (const comment of comments) {
    const notes: string[] = [];
    if (comment.moderationStatus !== "PUBLISHED") notes.push(`Moderation status: ${comment.moderationStatus}`);
    const links: ReportedContent["links"] = [];
    if (comment.gifUrl) links.push({ label: "GIF", href: comment.gifUrl });
    if (comment.audioUrl) links.push({ label: "Voice note", href: comment.audioUrl });
    if (comment.videoUrl) links.push({ label: "Video", href: comment.videoUrl });
    out.set(reportedContentKey({ targetType: "COMMENT", targetId: comment.id }), {
      exists: true,
      author: comment.author,
      text: cap(comment.content),
      notes,
      imageUrl: comment.gifUrl ?? comment.videoThumbnailUrl,
      mediaLabel: comment.videoUrl ? "VIDEO" : comment.audioUrl ? "AUDIO" : comment.gifUrl ? "GIF" : null,
      links,
      href: `/post/${comment.postId}`,
    });
  }

  for (const message of messages) {
    const notes: string[] = [];
    let text: string | null = cap(message.content);
    if (message.deletedForEveryoneAt) notes.push("Deleted for everyone by the sender.");
    if (message.moderationStatus !== "PUBLISHED") notes.push(`Moderation status: ${message.moderationStatus}`);
    if (text && isEncryptedContent(text)) {
      text = null;
      notes.push("End-to-end encrypted: we can't read this message. Any text the reporter attached is shown above.");
    }
    if (message.viewOnce) notes.push("View-once photo/video: the file is never kept for moderators.");
    const links: ReportedContent["links"] = [];
    if (message.mediaUrl) links.push({ label: `Attachment (${message.mediaType})`, href: message.mediaUrl });
    out.set(reportedContentKey({ targetType: "MESSAGE", targetId: message.id }), {
      exists: true,
      author: message.sender,
      text,
      notes,
      imageUrl:
        message.mediaThumbnailUrl ??
        (message.mediaType === "IMAGE" || message.mediaType === "GIF" ? message.mediaUrl : null),
      mediaLabel: message.mediaType === "NONE" ? null : message.mediaType,
      links,
      href: null,
    });
  }

  for (const circle of circles) {
    out.set(reportedContentKey({ targetType: "CIRCLE", targetId: circle.id }), {
      exists: true,
      author: circle.createdBy,
      text: cap(`${circle.name}\n\n${circle.description}`),
      notes: circle.visibility === "PRIVATE" ? ["PRIVATE Circle: its page opens for members only (see /admin/circles)."] : [],
      imageUrl: null,
      mediaLabel: null,
      links: [],
      href: circle.visibility === "PRIVATE" ? "/admin/circles" : `/circles/${circle.slug}`,
    });
  }

  for (const collab of collabs) {
    out.set(reportedContentKey({ targetType: "COLLAB_POST", targetId: collab.id }), {
      exists: true,
      author: collab.author,
      text: cap(`${collab.title}\n\n${collab.description}`),
      notes: collab.status !== "OPEN" ? [`Status: ${collab.status}`] : [],
      imageUrl: null,
      mediaLabel: null,
      links: [],
      href: `/collab/${collab.id}`,
    });
  }

  for (const user of users) {
    out.set(reportedContentKey({ targetType: "USER", targetId: user.id }), {
      exists: true,
      author: { id: user.id, name: user.name, username: user.username, status: user.status },
      text: cap(user.bio),
      notes: [],
      imageUrl: user.avatarUrl,
      mediaLabel: user.avatarUrl ? "Profile picture" : null,
      links: [],
      href: `/u/${user.id}`,
    });
  }

  return out;
}
