"use client";

import { useEffect } from "react";
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
        {/* A plain anchor, not next/link — this boundary is rendering because
            something in the client already broke, so its router state can't
            be trusted to actually perform a client-side transition. A real
            <a> forces a full navigation that always recovers, matching
            Next.js's own guidance for error.tsx "go home" links. */}
        <a href="/home" className="rounded-lg border border-line px-4 py-2 text-sm font-medium">
          Go home
        </a>
      </div>
    </div>
  );
}
