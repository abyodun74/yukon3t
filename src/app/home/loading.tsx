import { Skeleton, FeedSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="mt-2 h-4 w-64" />
      <Skeleton className="mt-6 h-24 w-full rounded-xl" />
      <div className="mt-8">
        <FeedSkeleton />
      </div>
    </div>
  );
}
