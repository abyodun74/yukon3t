"use client";

import { useEffect } from "react";
import Link from "next/link";
import { captureError } from "@/lib/error-tracking";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureError(error, { digest: error.digest });
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-foreground-soft">
        That didn&apos;t load right. Try again, or head back home.
      </p>
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
        >
          Try again
        </button>
        <Link href="/home" className="rounded-lg border border-line px-4 py-2 text-sm font-medium">
          Go home
        </Link>
      </div>
    </div>
  );
}
