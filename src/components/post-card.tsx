"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Calendar, Heart, Maximize2, MapPin, MessageSquare, Repeat2, Share2 } from "lucide-react";
import { Lightbox } from "@/components/lightbox";
import { toggleLike } from "@/app/actions/likes";
import { toggleRsvp } from "@/app/actions/rsvp";
import { repost } from "@/app/actions/reposts";
import { recordShare } from "@/app/actions/shares";
import { cn } from "@/lib/utils";
import { isEmojiOnly } from "@/lib/emoji";
import { PostOptionsMenu } from "@/components/post-options-menu";
import { TrustBadge } from "@/components/trust-badge";
import { embedSrc, type EmbedProvider } from "@/lib/video-embed";

type MediaType = "NONE" | "IMAGE" | "VIDEO" | "EMBED";

type EmbeddedPost = {
  id: string;
  content: string;
  mediaType: MediaType;
  mediaUrls: string[];
  videoUrl: string | null;
  videoThumbnailUrl: string | null;
  embedProvider: EmbedProvider | null;
  embedId: string | null;
  eventAt: Date | null;
  eventLocation: string | null;
  createdAt: Date;
  author: { id: string; name: string | null; trustBand: string };
};

type PostCardData = EmbeddedPost & {
  likeCount: number;
  commentCount: number;
  repostCount: number;
  shareCount: number;
  rsvpCount: number;
  likedByMe: boolean;
  repostedByMe: boolean;
  rsvpGoingByMe: boolean;
  repostOf: EmbeddedPost | null;
};

function EventBlock({
  post,
  going,
  rsvpCount,
  isPending,
  onToggle,
}: {
  post: EmbeddedPost;
  going: boolean;
  rsvpCount: number;
  isPending: boolean;
  onToggle: () => void;
}) {
  if (!post.eventAt) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-background px-3 py-2">
      <div className="text-xs text-foreground-soft">
        <div className="flex items-center gap-1.5">
          <Calendar size={13} />
          <span>
            {post.eventAt.toLocaleString([], {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        </div>
        {post.eventLocation && (
          <div className="mt-0.5 flex items-center gap-1.5">
            <MapPin size={13} />
            <span>{post.eventLocation}</span>
          </div>
        )}
      </div>
      <button
        type="button"
        disabled={isPending}
        onClick={onToggle}
        className={cn(
          "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-50",
          going ? "bg-success text-white" : "bg-accent text-accent-ink",
        )}
      >
        {going ? "Going ✓" : "I'm going"}
        {rsvpCount > 0 && <span className="ml-1.5 opacity-80">{rsvpCount}</span>}
      </button>
    </div>
  );
}

function MediaBlock({
  post,
  onOpenImage,
  onOpenVideo,
}: {
  post: EmbeddedPost;
  onOpenImage: (index: number) => void;
  onOpenVideo: () => void;
}) {
  return (
    <>
      {post.content && (
        <p className={cn("mt-2 whitespace-pre-wrap text-sm", isEmojiOnly(post.content) && "text-4xl leading-tight")}>
          {post.content}
        </p>
      )}

      {post.mediaType === "IMAGE" && post.mediaUrls.length > 0 && (
        <div
          className={cn(
            "mt-3 grid gap-1.5 overflow-hidden rounded-lg",
            post.mediaUrls.length === 1 ? "grid-cols-1" : "grid-cols-2",
          )}
        >
          {post.mediaUrls.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => onOpenImage(i)}
              className="block cursor-zoom-in"
            >
              {/* Plain <img>, not next/image: avoids routing user-uploaded
                  content through Next's bundled sharp (see SECURITY.md). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                className="max-h-96 w-full rounded-lg object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}

      {post.mediaType === "VIDEO" && post.videoUrl && (
        <div className="relative mt-3">
          <video
            controls
            preload="metadata"
            poster={post.videoThumbnailUrl ?? undefined}
            className="max-h-96 w-full rounded-lg bg-black"
          >
            <source src={post.videoUrl} />
          </video>
          <button
            type="button"
            onClick={onOpenVideo}
            title="Watch in full screen"
            className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white/90 hover:text-white"
          >
            <Maximize2 size={14} />
          </button>
        </div>
      )}

      {post.mediaType === "EMBED" && post.embedProvider && post.embedId && (
        <div className="mt-3 aspect-video overflow-hidden rounded-lg bg-black">
          <iframe
            src={embedSrc({ provider: post.embedProvider, id: post.embedId })}
            title="Embedded video"
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      )}
    </>
  );
}

export function PostCard({
  post,
  viewerId,
  viewerIsAdmin = false,
}: {
  post: PostCardData;
  viewerId: string;
  viewerIsAdmin?: boolean;
}) {
  const displayPost = post.repostOf ?? post;
  const interactionTargetId = post.repostOf?.id ?? post.id;

  const [liked, setLiked] = useState(post.likedByMe);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [reposted, setReposted] = useState(post.repostedByMe);
  const [repostCount, setRepostCount] = useState(post.repostCount);
  const [shareCount, setShareCount] = useState(post.shareCount);
  const [going, setGoing] = useState(post.rsvpGoingByMe);
  const [rsvpCount, setRsvpCount] = useState(post.rsvpCount);
  const [copied, setCopied] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxVideo, setLightboxVideo] = useState(false);
  const [isLikePending, startLikeTransition] = useTransition();
  const [isRepostPending, startRepostTransition] = useTransition();
  const [isSharePending, startShareTransition] = useTransition();
  const [isRsvpPending, startRsvpTransition] = useTransition();

  function handleLike() {
    const nextLiked = !liked;
    setLiked(nextLiked);
    setLikeCount((c) => c + (nextLiked ? 1 : -1));
    startLikeTransition(async () => {
      const result = await toggleLike(interactionTargetId);
      if (result.error) {
        setLiked(!nextLiked);
        setLikeCount((c) => c + (nextLiked ? -1 : 1));
      }
    });
  }

  function handleRsvp() {
    const nextGoing = !going;
    setGoing(nextGoing);
    setRsvpCount((c) => c + (nextGoing ? 1 : -1));
    startRsvpTransition(async () => {
      const result = await toggleRsvp(interactionTargetId);
      if (result.error) {
        setGoing(!nextGoing);
        setRsvpCount((c) => c + (nextGoing ? -1 : 1));
      }
    });
  }

  function handleRepost() {
    const nextReposted = !reposted;
    setReposted(nextReposted);
    setRepostCount((c) => c + (nextReposted ? 1 : -1));
    startRepostTransition(async () => {
      const fd = new FormData();
      fd.set("postId", interactionTargetId);
      const result = await repost(fd);
      if (result.error) {
        setReposted(!nextReposted);
        setRepostCount((c) => c + (nextReposted ? -1 : 1));
      }
    });
  }

  function handleShare() {
    const url = `${window.location.origin}/post/${interactionTargetId}`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
    startShareTransition(async () => {
      const result = await recordShare(interactionTargetId);
      if (!result.error && result.shareCount !== undefined) {
        setShareCount(result.shareCount);
      }
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-[var(--shadow-sm)]">
      {post.repostOf && (
        <Link
          href={`/u/${post.repostOf.author.id}`}
          className="mb-2 flex items-center gap-1.5 text-xs text-foreground-soft hover:text-accent"
        >
          <Repeat2 size={14} />
          Reposted from{" "}
          <span className="font-medium">{post.repostOf.author.name}</span>
        </Link>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={`/u/${displayPost.author.id}`}
            className="truncate text-sm font-semibold hover:text-accent"
          >
            {displayPost.author.name}
          </Link>
          <TrustBadge band={displayPost.author.trustBand} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-foreground-soft">
            {displayPost.createdAt.toLocaleDateString()}
          </span>
          <PostOptionsMenu
            postId={post.id}
            canDelete={viewerId === post.author.id || viewerIsAdmin}
            canReport={viewerId !== displayPost.author.id}
            reportTargetId={interactionTargetId}
            reportedUserId={displayPost.author.id}
          />
        </div>
      </div>

      {post.repostOf && post.content && (
        <p className="mt-2 whitespace-pre-wrap text-sm italic text-foreground-soft">
          {post.content}
        </p>
      )}

      <EventBlock
        post={displayPost}
        going={going}
        rsvpCount={rsvpCount}
        isPending={isRsvpPending}
        onToggle={handleRsvp}
      />

      <MediaBlock
        post={displayPost}
        onOpenImage={(index) => setLightboxIndex(index)}
        onOpenVideo={() => setLightboxVideo(true)}
      />

      <div className="mt-3 flex items-center gap-5 border-t border-line pt-2 text-xs text-foreground-soft">
        <button
          type="button"
          disabled={isLikePending}
          onClick={handleLike}
          className={cn(
            "flex items-center gap-1.5 hover:text-danger",
            liked && "text-danger",
          )}
        >
          <Heart size={16} fill={liked ? "currentColor" : "none"} />
          {likeCount > 0 && likeCount}
        </button>

        <Link
          href={`/post/${interactionTargetId}`}
          className="flex items-center gap-1.5 hover:text-accent"
        >
          <MessageSquare size={16} />
          {post.commentCount > 0 && post.commentCount}
        </Link>

        <button
          type="button"
          disabled={isRepostPending}
          onClick={handleRepost}
          className={cn(
            "flex items-center gap-1.5 hover:text-success",
            reposted && "text-success",
          )}
        >
          <Repeat2 size={16} />
          {repostCount > 0 && repostCount}
        </button>

        <button
          type="button"
          disabled={isSharePending}
          onClick={handleShare}
          className="flex items-center gap-1.5 hover:text-accent"
        >
          <Share2 size={16} />
          {shareCount > 0 && shareCount}
        </button>
        {copied && <span className="text-success">Link copied</span>}
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          images={displayPost.mediaUrls}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
      {lightboxVideo && displayPost.videoUrl && (
        <Lightbox video={displayPost.videoUrl} onClose={() => setLightboxVideo(false)} />
      )}
    </div>
  );
}
