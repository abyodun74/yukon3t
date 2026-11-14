import Link from "next/link";
import { UserAvatar } from "@/components/user-link";
import { CircleLongPress } from "@/components/circle-long-press";
import { cn } from "@/lib/utils";

type CircleSummary = {
  id: string;
  name: string;
  slug: string;
  coverImageUrl: string | null;
  visibility: "PUBLIC" | "PRIVATE";
  /** Set only for a sub-circle — its main Circle's name, so the tooltip reads "Main › Sub". */
  parentName?: string | null;
};

/**
 * Narrow rail of the caller's Circles, for jumping between them without
 * going back through /circles — real navigation via <Link>, not a query
 * param, since Circle identity is a path segment.
 */
export function CircleSwitcher({
  circles,
  activeCircleId,
}: {
  circles: CircleSummary[];
  activeCircleId: string;
}) {
  if (circles.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
      {circles.map((circle) => {
        const active = circle.id === activeCircleId;
        return (
          <CircleLongPress
            key={circle.id}
            circle={{ id: circle.id, slug: circle.slug, name: circle.name, visibility: circle.visibility }}
            className="shrink-0"
          >
          <Link
            href={`/circles/${circle.slug}`}
            title={circle.parentName ? `${circle.parentName} › ${circle.name}` : circle.name}
            // The avatar's own alt would read as "<Circle>'s profile photo".
            aria-label={circle.parentName ? `${circle.parentName}, ${circle.name}` : circle.name}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center justify-center rounded-full p-0.5 transition",
              active
                ? "bg-accent-soft ring-2 ring-accent"
                : "ring-1 ring-transparent hover:ring-line",
            )}
          >
            <UserAvatar avatarUrl={circle.coverImageUrl} name={circle.name} size={48} />
          </Link>
          </CircleLongPress>
        );
      })}
    </div>
  );
}
