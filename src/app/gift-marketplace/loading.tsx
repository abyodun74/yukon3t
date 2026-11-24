import { Skeleton } from "@/components/skeleton";

// The marketplace's skeleton while its catalog loads: header, search, category row and a grid of cards.
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-4" aria-hidden>
      <div className="flex items-start justify-between gap-3">
        <div>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-2 h-4 w-64" />
        </div>
        <Skeleton className="h-12 w-28 rounded-xl" />
      </div>
      <Skeleton className="mt-5 h-11 w-full rounded-xl" />
      <Skeleton className="mt-4 h-24 w-full rounded-2xl" />
      <div className="mt-4 flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-2xl border border-line">
            <Skeleton className="aspect-square w-full rounded-none" />
            <div className="p-2.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="mt-2 h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
