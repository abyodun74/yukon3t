import { UserAvatar } from "@/components/user-link";
import { formatTimeAgo } from "@/lib/format-date";
import { getDictionary, getLocale } from "@/lib/i18n/server";

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
export async function AmbientFeedPreview({ moments }: { moments: FeedMoment[] }) {
  const locale = await getLocale();
  const dictionary = await getDictionary();
  const t = dictionary.settings.ambient;

  if (moments.length === 0) {
    return <p className="text-sm text-foreground-soft">{t.feed.empty}</p>;
  }

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {moments.map((moment) => (
        <li key={moment.id} className="overflow-hidden rounded-xl border border-line bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={moment.imageUrl} alt={moment.caption ?? ""} className="aspect-square w-full object-cover" />
          <div className="flex items-center gap-1.5 p-2">
            <UserAvatar avatarUrl={moment.author.avatarUrl} name={moment.author.name} size={16} />
            <span dir="auto" className="truncate text-xs text-foreground-soft">{moment.author.name ?? t.circle.unnamed}</span>
            <span className="ms-auto shrink-0 text-[0.625rem] text-foreground-soft">
              {formatTimeAgo(moment.createdAt, locale, dictionary.ui.time.justNow)}
            </span>
          </div>
          {moment.caption && <p dir="auto" className="px-2 pb-2 text-xs">{moment.caption}</p>}
        </li>
      ))}
    </ul>
  );
}
