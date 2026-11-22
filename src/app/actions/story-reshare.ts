"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { isBlockedEitherWay } from "@/lib/blocks";
import { loadViewableStory } from "@/lib/profile-access-server";
import { canAccessChannel } from "@/lib/channel-permissions";
import { canViewPost, isMembersOnlyPost } from "@/lib/post-visibility";
import { museForComments } from "@/lib/muse-comments-data";
import { afterPostCreated } from "@/lib/post-created";
import { classifyPostCategory } from "@/lib/feed-category";
import { notifySubscribers } from "@/lib/notify-subscribers";
import { pushActivityNotification } from "@/lib/notify-push";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { isStreamConfigured, createStreamCopy } from "@/lib/cloudflare-stream";
import { probeStoredVideoSeconds } from "@/lib/video-duration-server";
import { HIVE_VIDEO_MODERATION_MAX_SECONDS, VIDEO_INSTANT_PUBLISH_MAX_SECONDS } from "@/lib/storage";
import {
  storyMediaCopyable,
  storyMuseBlock,
  storyRepostFeedAudience,
  storyRepostRequestId,
  storyRepostText,
  storyReshareOptions,
  storyVideoSeconds,
  type StoryReshareDestination,
} from "@/lib/story-reshare";

// "Post to my feed" / "Post to Muse" / "Post to a Circle" from the Story viewer's Share sheet. The rules (who, what, the
// audience, the credit) are src/lib/story-reshare.ts; this is the server half. Every action re-derives the caller, starts
// from loadViewableStory (the same gate as every Story action in actions/stories.ts), checks the author's opt-out, and
// COPIES the Story's media into a new Post or Muse (never a reference to the Story, which expires in 24h).
//
// Moderation: a Story's photo, video still frame and caption were checked by createStory (a flag rejects it there), and
// an embed is moderated by its source, so the copy needs no new check for those. A Story's VIDEO body was never scanned
// (the moderate-videos cron doesn't read Stories), so a video copy is routed exactly like a new upload: up to
// HIVE_VIDEO_MODERATION_MAX_SECONDS it publishes with videoModeratedAt null (the moderate-videos cron scans it); longer
// takes the Cloudflare Stream long review (videoLongReviewNeeded + an eager createStreamCopy): a Post publishes at once
// (instant-publish range, a Story video is at most 2 minutes), a Muse publishes FLAGGED until the review clears, like
// shareToMuse / createMuse. A video whose length the phone couldn't read is measured from the stored file first
// (withKnownVideoLength); one still unknown is never sent to the long review (it keys on a known length, so the copy
// would never be reviewed): a Post copy goes to the moderate-videos cron like createPost's unknown-length upload, and
// Muse refuses it (`unsupported_media`; createMuse requires a length too). There is no audio-only Story to route.
//
// Sound track: a Story made from a Muse can carry that Muse's added sound track (Story.audioUrl). A Muse copy keeps it
// (Muse.audioUrl, the same file). A Post has no audio field, so a Feed / Circle copy plays the video's own sound; the
// Share sheet says so beforehand (storyReshareOptions' soundTrackNote). The track was never scanned as audio, exactly
// as on the Muse it came from (createMuse doesn't scan Muse audio either).

/** Media columns read from a Story for a copy, plus its author's two settings this needs. */
const STORY_SOURCE_SELECT = {
  id: true,
  authorId: true,
  mediaType: true,
  mediaUrl: true,
  mediaThumbnailUrl: true,
  audioUrl: true,
  videoDurationSeconds: true,
  embedProvider: true,
  embedId: true,
  caption: true,
  sharedPostId: true,
  sharedMuseId: true,
  isReshare: true,
  author: { select: { name: true, username: true, postsVisibility: true, allowStoryReposts: true } },
} as const;

/**
 * A Story made by shareToStory carries someone's post's media (Story.sharedPostId). The copy would put that post's
 * media on the reposter's own Feed / Muse / Circle, so the post itself must still be one the reposter could reshare:
 * live, visible to them (canViewPost: blocks either way with ITS author, its audience, a PRIVATE Circle), PUBLIC, and not
 * members-only (the same rule as shareToStory / shareToMuse / shareToCircle). Otherwise a block or a narrowed audience
 * on the original would be bypassed through someone else's Story. The reposter's own post always passes.
 */
async function sharedPostAllowsRepost(userId: string, sharedPostId: string) {
  const post = await prisma.post.findUnique({
    where: { id: sharedPostId },
    select: { authorId: true, visibility: true, moderationStatus: true, circleId: true, channelId: true },
  });
  if (!post) return false;
  if (post.authorId === userId) return true;
  if (post.moderationStatus !== "PUBLISHED" || post.visibility !== "PUBLIC") return false;
  if (await isMembersOnlyPost(post)) return false;
  return canViewPost(sharedPostId, userId);
}

/**
 * A Story made by shareMuseToStory carries a Muse's media (Story.sharedMuseId, used only for this check). The Muse must
 * still be one the reposter could see on Muse: it exists, is PUBLISHED (not FLAGGED / held for review, even for its own
 * author: a held Muse isn't public yet) and its author isn't blocked either way with the reposter. That is
 * museForComments, the same gate every Muse read uses (published + isBlockedEitherWay).
 */
async function sharedMuseAllowsRepost(userId: string, sharedMuseId: string) {
  return (await museForComments(sharedMuseId, userId)) !== null;
}

/**
 * Whether a Story built from someone's content (shareToStory / shareMuseToStory) may be copied by this reposter. A
 * Story that isn't a reshare passes. One that is must still point at a source that allows it; sharedPostId and
 * sharedMuseId are SetNull, so a deleted source leaves a Story with isReshare true and neither id: refused, never
 * treated as an original upload. Stories created before isReshare existed read false (transitional, at most 24h).
 */
async function reshareSourceAllowsRepost(
  userId: string,
  story: { isReshare: boolean; sharedPostId: string | null; sharedMuseId: string | null },
) {
  if (story.sharedPostId && !(await sharedPostAllowsRepost(userId, story.sharedPostId))) return false;
  if (story.sharedMuseId && !(await sharedMuseAllowsRepost(userId, story.sharedMuseId))) return false;
  if (story.isReshare && !story.sharedPostId && !story.sharedMuseId) return false;
  return true;
}

type ReshareUser = Awaited<ReturnType<typeof requireVerifiedUser>>;

/**
 * The Story to copy, or the refusal: `blocked` (a block either way with its author, its own answer like replyToStory's),
 * `not_found` (missing, expired, or the author's Stories aren't visible to the caller), `opted_out` (someone else's
 * Story whose author turned reposting off), `not_shareable` (a Story made from a post or Muse the caller couldn't
 * reshare themselves, or whose source was deleted: reshareSourceAllowsRepost).
 */
async function loadRepostSource(userId: string, storyId: unknown) {
  if (typeof storyId !== "string" || !storyId) return { error: "not_found" as const };
  const raw = await prisma.story.findUnique({ where: { id: storyId }, select: STORY_SOURCE_SELECT });
  if (raw && raw.authorId !== userId && (await isBlockedEitherWay(userId, raw.authorId))) {
    return { error: "blocked" as const };
  }
  const viewable = await loadViewableStory(userId, storyId);
  if (!viewable || !raw) return { error: "not_found" as const };
  const own = raw.authorId === userId;
  if (!own && !raw.author.allowStoryReposts) return { error: "opted_out" as const };
  if (!(await reshareSourceAllowsRepost(userId, raw))) {
    return { error: "not_shareable" as const };
  }
  return { error: null, story: await withKnownVideoLength(raw), own };
}

type LengthFields = { id: string; mediaType: string; mediaUrl: string | null; videoDurationSeconds: number | null };

/**
 * A video Story without a stored length (the phone couldn't read it, or it was posted before lengths were kept) gets
 * it from the stored file's MP4/MOV container (probeStoredVideoSeconds), saved on the Story so the next sheet or
 * repost doesn't read it again. Unchanged when that can't be read either. Best-effort: never fails the repost.
 */
async function withKnownVideoLength<T extends LengthFields>(story: T): Promise<T> {
  if (story.mediaType !== "VIDEO" || storyVideoSeconds(story) !== null) return story;
  const seconds = await probeStoredVideoSeconds(story.mediaUrl);
  if (seconds === null) return story;
  await prisma.story
    .updateMany({ where: { id: story.id, videoDurationSeconds: null }, data: { videoDurationSeconds: seconds } })
    .catch((err: unknown) => console.error("[story-reshare] couldn't save a measured story length", err));
  return { ...story, videoDurationSeconds: seconds };
}

type RepostSource = Extract<Awaited<ReturnType<typeof loadRepostSource>>, { error: null }>;

/**
 * The bell row + push telling a Story's author someone posted a copy (STORY_REPOST): never for their own repost, and
 * only when they can open the copy (a Friends-only copy by someone they aren't connected to, or a members-only Circle
 * they aren't in, would be a dead link that reveals it exists). Best-effort: a failure never undoes the copy.
 */
async function notifyStoryAuthor(
  source: RepostSource,
  reposter: { id: string; name: string | null },
  copy: { postId: string } | { museId: string },
) {
  if (source.own) return;
  try {
    if ("postId" in copy && !(await canViewPost(copy.postId, source.story.authorId))) return;
    await prisma.notification.create({
      data: { recipientId: source.story.authorId, actorId: reposter.id, type: "STORY_REPOST", ...copy },
    });
    const url = "postId" in copy ? `/post/${copy.postId}` : `/muse/${copy.museId}`;
    await pushActivityNotification(source.story.authorId, "STORY_REPOST", reposter.name, url);
  } catch (err) {
    console.error("[story-reshare] couldn't notify the story's author", err);
  }
}

/**
 * Which destinations the Share sheet offers for this Story (src/lib/story-reshare.ts storyReshareOptions), so a row
 * that would be refused isn't shown: none when the author turned reposting off or the media can't be copied, no Muse
 * for a photo or for a video whose length is unknown or over Muse's limit (museBlocked says which), and only Feed for
 * someone else's Friends-only Story.
 */
export async function getStoryReshareOptions(storyId: string) {
  const user = await requireVerifiedUser();
  const source = await loadRepostSource(user.id, storyId);
  if (source.error === "opted_out") {
    return {
      error: null,
      feed: false,
      muse: false,
      circle: false,
      reason: "opted_out" as const,
      museBlocked: null,
      soundTrackNote: false,
    };
  }
  if (source.error) {
    return {
      error: source.error,
      feed: false,
      muse: false,
      circle: false,
      reason: null,
      museBlocked: null,
      soundTrackNote: false,
    };
  }
  return {
    error: null,
    ...storyReshareOptions({
      own: source.own,
      authorAllowsReposts: source.story.author.allowStoryReposts,
      authorPostsVisibility: source.story.author.postsVisibility,
      media: source.story,
    }),
  };
}

/** The existing copy for this key, if a previous attempt already made it. */
async function existingPostFor(authorId: string, clientRequestId: string) {
  return prisma.post.findUnique({
    where: { authorId_clientRequestId: { authorId, clientRequestId } },
    select: { id: true },
  });
}

/**
 * Creates the Post copy (Feed when no channel, else that Circle channel) and runs createPost's after-steps
 * (afterPostCreated: embedding, activity, subscriber / connection notifications, the Home feed signal).
 */
async function createPostCopy(
  user: ReshareUser,
  source: RepostSource,
  destination: StoryReshareDestination,
  channel: { id: string; circleId: string } | null,
) {
  const { story } = source;
  const clientRequestId = storyRepostRequestId(story.id, destination, channel?.circleId);
  const content = storyRepostText({ own: source.own, author: story.author, caption: story.caption, max: 50_000 });

  // A video copy is routed like a new upload (see the file header). A Story video is at most 2 minutes, inside the
  // instant-publish range, but the hold is kept for any longer length a client reported. An unknown length (null)
  // takes createPost's unknown-length route: published, videoModeratedAt null, so the moderate-videos cron scans it.
  const duration = story.mediaType === "VIDEO" ? storyVideoSeconds(story) : null;
  const videoNeedsLongReview = duration !== null && duration > HIVE_VIDEO_MODERATION_MAX_SECONDS;
  const moderationStatus: "PUBLISHED" | "FLAGGED" =
    duration !== null && duration > VIDEO_INSTANT_PUBLISH_MAX_SECONDS ? "FLAGGED" : "PUBLISHED";
  const streamUidPromise =
    videoNeedsLongReview && isStreamConfigured() ? createStreamCopy(story.mediaUrl!) : Promise.resolve(null);
  const { category: feedCategory, embedding } = await classifyPostCategory(content);
  const streamUid = await streamUidPromise;

  const media =
    story.mediaType === "IMAGE"
      ? { mediaType: "IMAGE" as const, mediaUrls: [story.mediaUrl!] }
      : story.mediaType === "VIDEO"
        ? {
            mediaType: "VIDEO" as const,
            videoUrl: story.mediaUrl!,
            videoThumbnailUrl: story.mediaThumbnailUrl,
            videoDurationSeconds: duration,
            // Long videos skip the moderate-videos cron (pre-claimed) and go to the long review instead.
            videoModeratedAt: videoNeedsLongReview ? new Date() : null,
            videoStreamUid: streamUid,
            videoLongReviewNeeded: videoNeedsLongReview,
          }
        : { mediaType: "EMBED" as const, embedProvider: story.embedProvider!, embedId: story.embedId! };

  let post;
  try {
    post = await prisma.post.create({
      data: {
        authorId: user.id,
        circleId: channel?.circleId ?? null,
        channelId: channel?.id ?? null,
        content,
        // Inside a Circle membership is the boundary (stored PUBLIC, as createPost does); on Feed the narrower of the
        // author's and the reposter's profile settings, never wider.
        visibility: channel
          ? "PUBLIC"
          : source.own
            ? storyRepostFeedAudience(user.postsVisibility)
            : storyRepostFeedAudience(story.author.postsVisibility, user.postsVisibility),
        feedCategory,
        moderationStatus,
        clientRequestId,
        ...media,
      },
      select: { id: true, authorId: true, circleId: true, channelId: true, visibility: true },
    });
  } catch (err) {
    // A concurrent attempt of the same repost won the (authorId, clientRequestId) unique: that one is the copy.
    if (isUniqueConstraintError(err)) {
      const existing = await existingPostFor(user.id, clientRequestId);
      if (existing) return { postId: existing.id, created: false, moderationStatus };
    }
    throw err;
  }
  await afterPostCreated({ post, moderationStatus, feedCategory, embedding, mediaType: story.mediaType });
  return { postId: post.id, created: true, moderationStatus };
}

/**
 * "Post to my feed": a copy of the Story on the caller's own Feed and profile, credited to its author when it isn't
 * theirs, with the narrower of the two profiles' audience. Idempotent per (caller, Story): a retry or a second tap answers
 * the post already made (`already: true`).
 */
export async function shareStoryToFeed(storyId: string) {
  const user = await requireVerifiedUser();
  if (typeof storyId !== "string" || !storyId) return { error: "invalid" as const };

  const existing = await existingPostFor(user.id, storyRepostRequestId(storyId, "feed"));
  if (existing) return { error: null, postId: existing.id, already: true };

  if (!(await checkRateLimit("postCreate", user.id))) return { error: "rate_limited" as const };

  const source = await loadRepostSource(user.id, storyId);
  if (source.error) return { error: source.error };
  if (!storyMediaCopyable(source.story)) return { error: "unsupported_media" as const };

  const copy = await createPostCopy(user, source, "feed", null);
  if (copy.created && copy.moderationStatus === "PUBLISHED") {
    await notifyStoryAuthor(source, user, { postId: copy.postId });
  }

  revalidatePath("/home");
  revalidatePath(`/u/${user.id}`);
  return { error: null, postId: copy.postId, already: !copy.created };
}

const circleIdSchema = z.string().min(1).max(64);

/**
 * "Post to a Circle": a copy of the Story in one of the caller's Circles, in the first text channel (by position) they
 * may post in: createPost's own rule (canAccessChannel: a member; a public channel, a private one they're allow-listed
 * in, or any as the owner / a co-admin). Not a member: `not_a_member` for a PUBLIC Circle, `not_found` for a PRIVATE one
 * (which doesn't exist for a non-member). Someone else's Story only when its author's profile is PUBLIC
 * (`not_shareable`). Idempotent per (caller, Story, Circle).
 */
export async function shareStoryToCircle(storyId: string, circleId: string) {
  const user = await requireVerifiedUser();
  const parsedCircle = circleIdSchema.safeParse(circleId);
  if (typeof storyId !== "string" || !storyId || !parsedCircle.success) return { error: "invalid" as const };

  const existing = await existingPostFor(user.id, storyRepostRequestId(storyId, "circle", parsedCircle.data));
  if (existing) return { error: null, postId: existing.id, already: true };

  if (!(await checkRateLimit("shareToCircle", user.id))) return { error: "rate_limited" as const };

  const source = await loadRepostSource(user.id, storyId);
  if (source.error) return { error: source.error };
  if (!source.own && source.story.author.postsVisibility !== "PUBLIC") return { error: "not_shareable" as const };
  if (!storyMediaCopyable(source.story)) return { error: "unsupported_media" as const };

  const circle = await prisma.circle.findUnique({
    where: { id: parsedCircle.data },
    select: { id: true, slug: true, visibility: true, createdById: true },
  });
  if (!circle) return { error: "not_found" as const };
  const membership = await prisma.circleMembership.findUnique({
    where: { userId_circleId: { userId: user.id, circleId: circle.id } },
    select: { id: true },
  });
  if (!membership) return { error: circle.visibility === "PRIVATE" ? ("not_found" as const) : ("not_a_member" as const) };

  const channels = await prisma.channel.findMany({
    where: { circleId: circle.id, type: "TEXT" },
    orderBy: { position: "asc" },
    select: { id: true, circleId: true, visibility: true },
  });
  let channel: (typeof channels)[number] | null = null;
  for (const candidate of channels) {
    if (await canAccessChannel(candidate, circle, user)) {
      channel = candidate;
      break;
    }
  }
  if (!channel) return { error: "not_a_member" as const };

  const copy = await createPostCopy(user, source, "circle", channel);
  if (copy.created && copy.moderationStatus === "PUBLISHED") {
    await notifyStoryAuthor(source, user, { postId: copy.postId });
  }

  revalidatePath(`/circles/${circle.slug}`);
  revalidatePath("/home");
  return { error: null, postId: copy.postId, already: !copy.created };
}

/**
 * "Post to Muse": a copy of a video or embed Story as a new Muse of the caller's (a photo, or a video whose length
 * couldn't be read even from the stored file, can't go to Muse: `unsupported_media`; one over Muse's limit: `too_long`). Muse is public to everyone, so someone else's Story only when its author's profile is PUBLIC
 * (`not_shareable`). A video over HIVE_VIDEO_MODERATION_MAX_SECONDS publishes FLAGGED until the long review clears it,
 * exactly like shareToMuse; the author is told only about a copy that is live. Idempotent per (caller, Story).
 */
export async function shareStoryToMuse(storyId: string) {
  const user = await requireVerifiedUser();
  if (typeof storyId !== "string" || !storyId) return { error: "invalid" as const };
  const clientRequestId = storyRepostRequestId(storyId, "muse");

  const existingMuse = () =>
    prisma.muse.findUnique({
      where: { authorId_clientRequestId: { authorId: user.id, clientRequestId } },
      select: { id: true },
    });
  const existing = await existingMuse();
  if (existing) return { error: null, museId: existing.id, already: true };

  if (!(await checkRateLimit("postCreate", user.id))) return { error: "rate_limited" as const };

  const source = await loadRepostSource(user.id, storyId);
  if (source.error) return { error: source.error };
  const { story } = source;
  if (!source.own && story.author.postsVisibility !== "PUBLIC") return { error: "not_shareable" as const };
  if (!storyMediaCopyable(story)) return { error: "unsupported_media" as const };
  const museBlock = storyMuseBlock(story);
  if (museBlock === "too_long") return { error: "too_long" as const };
  if (museBlock) return { error: "unsupported_media" as const };
  const seconds = storyVideoSeconds(story);

  const caption = storyRepostText({ own: source.own, author: story.author, caption: story.caption, max: 200 }) || null;
  const videoNeedsManualReview = seconds !== null && seconds > HIVE_VIDEO_MODERATION_MAX_SECONDS;
  const streamUid = videoNeedsManualReview && isStreamConfigured() ? await createStreamCopy(story.mediaUrl!) : null;
  const moderationStatus = videoNeedsManualReview ? ("FLAGGED" as const) : ("PUBLISHED" as const);

  let museId: string;
  try {
    const muse = await prisma.muse.create({
      data: {
        authorId: user.id,
        caption,
        clientRequestId,
        moderationStatus,
        ...(story.mediaType === "EMBED"
          ? { mediaType: "EMBED" as const, embedProvider: story.embedProvider!, embedId: story.embedId! }
          : {
              mediaType: "VIDEO" as const,
              videoUrl: story.mediaUrl!,
              videoThumbnailUrl: story.mediaThumbnailUrl,
              videoDurationSeconds: seconds!,
              // A Story made from a Muse with a sound track keeps it on the copy (the same file; the media reference
              // check keeps it while any row uses it).
              audioUrl: story.audioUrl,
              // Over the scan limit: pre-claimed so the moderate-videos cron skips it; the long review keys on
              // videoLongReviewNeeded. Otherwise null, so the moderate-videos cron scans the body.
              videoModeratedAt: videoNeedsManualReview ? new Date() : null,
              videoStreamUid: streamUid,
              videoLongReviewNeeded: videoNeedsManualReview,
            }),
      },
      select: { id: true },
    });
    museId = muse.id;
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      const raced = await existingMuse();
      if (raced) return { error: null, museId: raced.id, already: true };
    }
    throw err;
  }

  if (moderationStatus === "PUBLISHED") {
    await notifySubscribers(user.id, "SUBSCRIPTION_MUSE", { museId });
    await notifyStoryAuthor(source, user, { museId });
  }

  revalidatePath("/muse");
  revalidatePath(`/u/${user.id}`);
  return { error: null, museId, already: false, held: moderationStatus === "FLAGGED" };
}
