import { formatDistanceToNow } from "date-fns";
import { UserAvatar } from "@/components/user-link";

type FeedMoment = {
  id: string;
  imageUrl: string;
  caption: string | null;
  createdAt: Date;
  author: { id: string; name: string | null; username: string | null; avatarUrl: string | null };
};

/**
 * Server component — a plain preview of what GET /api/ambient/feed returns
 * for this viewer, rendered inside the app since there's no lock-screen/
 * widget/watch surface yet to show it for real.
 */
export function AmbientFeedPreview({ moments }: { moments: FeedMoment[] }) {
  if (moments.length === 0) {
    return (
      <p className="text-sm text-foreground-soft">
        Nothing from your Inner Circle right now — moments show up here (and would show up on a
        future widget) for 48 hours after someone shares one.
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {moments.map((moment) => (
        <li key={moment.id} className="overflow-hidden rounded-xl border border-line bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={moment.imageUrl} alt={moment.caption ?? ""} className="aspect-square w-full object-cover" />
          <div className="flex items-center gap-1.5 p-2">
            <UserAvatar avatarUrl={moment.author.avatarUrl} name={moment.author.name} size={16} />
            <span className="truncate text-xs text-foreground-soft">{moment.author.name ?? "Unnamed"}</span>
            <span className="ml-auto shrink-0 text-[0.625rem] text-foreground-soft">
              {formatDistanceToNow(moment.createdAt, { addSuffix: true })}
            </span>
          </div>
          {moment.caption && <p className="px-2 pb-2 text-xs">{moment.caption}</p>}
        </li>
      ))}
    </ul>
  );
}
