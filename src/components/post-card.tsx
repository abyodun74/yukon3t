import Link from "next/link";
import { ReportButton } from "@/components/report-form";
import { cn } from "@/lib/utils";

type PostCardData = {
  id: string;
  content: string;
  mediaType: "NONE" | "IMAGE" | "VIDEO";
  mediaUrls: string[];
  videoUrl: string | null;
  videoThumbnailUrl: string | null;
  createdAt: Date;
  author: { id: string; name: string | null };
};

export function PostCard({ post }: { post: PostCardData }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex items-center justify-between">
        <Link
          href={`/u/${post.author.id}`}
          className="text-sm font-semibold hover:text-accent"
        >
          {post.author.name}
        </Link>
        <span className="text-xs text-foreground-soft">
          {post.createdAt.toLocaleDateString()}
        </span>
      </div>

      {post.content && (
        <p className="mt-2 whitespace-pre-wrap text-sm">{post.content}</p>
      )}

      {post.mediaType === "IMAGE" && post.mediaUrls.length > 0 && (
        <div
          className={cn(
            "mt-3 grid gap-1.5 overflow-hidden rounded-lg",
            post.mediaUrls.length === 1 ? "grid-cols-1" : "grid-cols-2",
          )}
        >
          {post.mediaUrls.map((url) => (
            // Plain <img>, not next/image: avoids routing user-uploaded
            // content through Next's bundled sharp (see SECURITY.md).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={url}
              src={url}
              alt=""
              className="max-h-96 w-full rounded-lg object-cover"
              loading="lazy"
            />
          ))}
        </div>
      )}

      {post.mediaType === "VIDEO" && post.videoUrl && (
        <video
          controls
          preload="metadata"
          poster={post.videoThumbnailUrl ?? undefined}
          className="mt-3 max-h-96 w-full rounded-lg bg-black"
        >
          <source src={post.videoUrl} />
        </video>
      )}

      <div className="mt-2">
        <ReportButton
          targetType="POST"
          targetId={post.id}
          reportedUserId={post.author.id}
        />
      </div>
    </div>
  );
}
