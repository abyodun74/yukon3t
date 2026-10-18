import { prisma } from "@/lib/prisma";
import { toPgVector } from "@/lib/embeddings";
import { recordActivity } from "@/lib/trust";
import { track } from "@/lib/analytics";
import { isMembersOnlyPost } from "@/lib/post-visibility";
import { notifySubscribers } from "@/lib/notify-subscribers";
import { notifyConnections } from "@/lib/notify-connections";
import { publishEvent } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";

/**
 * Everything that follows creating a Post row, shared by createPost (actions/circles.ts) and the Circle event post
 * schedulePollOption (actions/polls.ts) creates, so the two can't drift apart. Before calling, the caller has moderated
 * the content and classified it (classifyPostCategory: the row's feedCategory, and the `embedding` passed here).
 *
 * Stores the post's embedding, records the author's activity and the POST_CREATED analytics event, then notifies:
 * subscribers (and the Home feed's realtime channels) for a PUBLISHED, PUBLIC post outside a members-only Circle or
 * channel, or connections only for a CONNECTIONS_ONLY one. notifySubscribers' fan-out still runs synchronously inside
 * the request (see "Known open items" in CLAUDE.md), exactly as it always has for createPost.
 */
export async function afterPostCreated({
  post,
  moderationStatus,
  feedCategory,
  embedding,
  mediaType,
}: {
  post: { id: string; authorId: string; circleId: string | null; channelId: string | null; visibility: string };
  moderationStatus: "PUBLISHED" | "FLAGGED";
  feedCategory: string | null;
  embedding: number[] | null;
  mediaType: string;
}) {
  // Only the lead post's caption/embed-title vector is stored — an album's
  // non-lead siblings have no caption of their own to embed, and (per
  // LEAD_POST_ONLY) never surface in a search/semantic result independently
  // of their lead anyway, so there's nothing for their own embedding to do.
  if (embedding) {
    await prisma.$executeRaw`UPDATE "Post" SET "embedding" = ${toPgVector(embedding)}::vector WHERE "id" = ${post.id}`;
  }
  await recordActivity(post.authorId);
  await track("POST_CREATED", post.authorId, { circleId: post.circleId ?? null, mediaType });

  // Notify subscribers of new content. Skipped for flagged content, and for
  // anything other than PUBLIC visibility — a subscriber isn't necessarily
  // an accepted connection, so a Friends-only/Private post shouldn't point
  // them at something getVisiblePostsWhere would then just hide from them.
  // A PRIVATE Circle's posts (and a private channel's) are members-only yet stored PUBLIC, so visibility alone can't
  // tell them apart: without this check the author's subscribers and connections (who need not be members) were
  // notified about a post they can't open — revealing that it exists — and the Home feed was told to refetch. Posts
  // in a PUBLIC Circle are general/public and notify as before.
  const membersOnly = await isMembersOnlyPost(post);
  if (moderationStatus === "PUBLISHED" && post.visibility === "PUBLIC" && !membersOnly) {
    await notifySubscribers(post.authorId, "SUBSCRIPTION_POST", { postId: post.id });
    // Tells any open Home feed tab to refetch — both the matching category
    // tab and "All" (PostFeedSection's own category prop), same "thin
    // signal, go refetch through the existing already-authorized query"
    // shape as every other realtime channel in this app. Harmless if a
    // given viewer's getVisiblePostsWhere/buildCategoryFilter ends up
    // returning nothing new for them (e.g. this post isn't actually visible
    // to them) — the refetch just comes back empty.
    await Promise.all([
      publishEvent(REALTIME_CHANNELS.homeFeed("all"), "changed"),
      ...(feedCategory ? [publishEvent(REALTIME_CHANNELS.homeFeed(feedCategory), "changed")] : []),
    ]);
  } else if (moderationStatus === "PUBLISHED" && post.visibility === "CONNECTIONS_ONLY" && !membersOnly) {
    // The PUBLIC branch above already reaches every accepted connection too
    // (accepting a connection request auto-subscribes both sides — see
    // respondToConnectionRequest in actions/connections.ts), so this is
    // mutually exclusive with it, not additive: a CONNECTIONS_ONLY post is
    // invisible to a subscriber who isn't also a connection, so only actual
    // connections get notified here instead of everyone the author is
    // subscribed by.
    await notifyConnections(post.authorId, "CONNECTION_POST", { postId: post.id });
  }
}
