import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="flex items-center gap-3 border-b border-line pb-4">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="mt-4 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton
            key={i}
            className={`h-9 rounded-2xl ${i % 2 === 0 ? "ml-auto w-1/2" : "w-2/5"}`}
          />
        ))}
      </div>
    </div>
  );
}
