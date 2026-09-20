import Link from "next/link";
import { Lock, Plus } from "lucide-react";
import { CircleMembershipButton } from "@/components/circle-membership-button";

export type SubCircleSummary = {
  id: string;
  name: string;
  slug: string;
  description: string;
  coverImageUrl: string | null;
  visibility: "PUBLIC" | "PRIVATE";
  createdById: string;
  _count: { members: number };
  /** The viewer's own membership row in this sub-circle, if any (query filtered by userId). */
  members: { role: string }[];
};

/**
 * The sub-circles under a main Circle, listed on its page. Each is a full
 * Circle with its own members, so each card joins/leaves on its own through
 * the same CircleMembershipButton as everywhere else — joining one doesn't
 * touch membership in the main Circle or any other sub-circle. Its member
 * list lives on its own page, like any Circle.
 *
 * `canAdd` is true only for the main Circle's owner (see
 * checkSubCircleParent); it also decides whether an empty list is shown at
 * all — nobody else has any use for a "No sub-circles yet" box.
 */
export function SubCircleList({
  parentSlug,
  subCircles,
  viewerId,
  pendingRequestCircleIds,
  canAdd,
}: {
  parentSlug: string;
  subCircles: SubCircleSummary[];
  viewerId: string;
  pendingRequestCircleIds: string[];
  canAdd: boolean;
}) {
  if (subCircles.length === 0 && !canAdd) return null;
  const pending = new Set(pendingRequestCircleIds);

  return (
    <section id="sub-circles" className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
            Sub-circles{subCircles.length > 0 ? ` · ${subCircles.length}` : ""}
          </h2>
          {subCircles.length > 0 && (
            <p className="mt-1 text-xs text-foreground-soft">
              Join any of these on its own — each has its own members.
            </p>
          )}
        </div>
        {canAdd && (
          <Link
            href={`/circles/new?parent=${encodeURIComponent(parentSlug)}`}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent"
          >
            <Plus size={14} />
            Add a sub-circle
          </Link>
        )}
      </div>

      {subCircles.length === 0 ? (
        <p className="mt-3 rounded-xl border border-line p-4 text-sm text-foreground-soft">
          No sub-circles yet. Add one to give a part of this Circle its own space and its own members.
        </p>
      ) : (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {subCircles.map((sub) => {
            const isMember = sub.members.length > 0;
            const count = sub._count.members;
            return (
              <li key={sub.id} className="min-w-0 rounded-xl border border-line p-4">
                <Link href={`/circles/${sub.slug}`} className="flex items-center gap-3 hover:text-accent">
                  {sub.coverImageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={sub.coverImageUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-10 w-10 shrink-0 rounded-lg object-cover"
                    />
                  )}
                  <span className="min-w-0 truncate font-semibold">{sub.name}</span>
                  {sub.visibility === "PRIVATE" && (
                    <span title="Private — join by request" className="flex shrink-0 items-center text-foreground-soft">
                      <Lock size={12} />
                    </span>
                  )}
                </Link>
                <p className="mt-2 line-clamp-2 break-words text-sm text-foreground-soft">{sub.description}</p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-foreground-soft">
                    {count} member{count === 1 ? "" : "s"}
                  </span>
                  <CircleMembershipButton
                    circleId={sub.id}
                    isMember={isMember}
                    isOwner={sub.createdById === viewerId}
                    visibility={sub.visibility}
                    hasPendingRequest={pending.has(sub.id)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
