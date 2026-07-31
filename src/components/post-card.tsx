"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Heart, Maximize2, MessageSquare, Repeat2, Share2 } from "lucide-react";
import { Lightbox } from "@/components/lightbox";
import { toggleLike } from "@/app/actions/likes";
import { repost } from "@/app/actions/reposts";
import { recordShare } from "@/app/actions/shares";
import { cn } from "@/lib/utils";
import { isEmojiOnly } from "@/lib/emoji";
import { PostOptionsMenu } from "@/components/post-options-menu";

type MediaType = "NONE" | "IMAGE" | "VIDEO";

type EmbeddedPost = {
  id: string;
  content: string;
  mediaType: MediaType;
  mediaUrls: string[];
  videoUrl: string | null;
  videoThumbnailUrl: string | null;
  createdAt: Date;
  author: { id: string; name: string | null };
};

type PostCardData = EmbeddedPost & {
  likeCount: number;
  commentCount: number;
  repostCount: number;
  shareCount: number;
  likedByMe: boolean;
  repostedByMe: boolean;
  repostOf: EmbeddedPost | null;
};

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
  const [copied, setCopied] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lightboxVideo, setLightboxVideo] = useState(false);
  const [isLikePending, startLikeTransition] = useTransition();
  const [isRepostPending, startRepostTransition] = useTransition();
  const [isSharePending, startShareTransition] = useTransition();

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
    <div className="rounded-xl border border-line p-4">
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

      <div className="flex items-center justify-between">
        <Link
          href={`/u/${displayPost.author.id}`}
          className="text-sm font-semibold hover:text-accent"
        >
          {displayPost.author.name}
        </Link>
        <div className="flex items-center gap-2">
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
