import { Skeleton, FeedSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Skeleton className="h-3 w-16" />
      <div className="mt-1 flex items-center justify-between gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>
      <Skeleton className="mt-2 h-4 w-full" />
      <Skeleton className="mt-1 h-3 w-24" />
      <Skeleton className="mt-8 h-16 w-full rounded-xl" />
      <Skeleton className="mt-4 h-24 w-full rounded-xl" />
      <div className="mt-8">
        <FeedSkeleton />
      </div>
    </div>
  );
}
