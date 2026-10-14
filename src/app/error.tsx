"use client";

import { useEffect } from "react";
import { captureError } from "@/lib/error-tracking";
import { useStaleBuildRecovery } from "@/lib/stale-build-client";
import { useShellText } from "@/components/ui-text";

export default function ErrorBoundary({
  error,
  retry: recover,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const { t } = useShellText();
  useEffect(() => {
    captureError(error, { digest: error.digest });
  }, [error]);

  // A client left behind by a deploy lands here on its first stale chunk or
  // Server Action; that case reloads itself onto the new build.
  const { checking, retry } = useStaleBuildRecovery(recover, error);
  if (checking) return <div className="py-20" aria-busy="true" />;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-20 text-center">
      <h1 className="text-xl font-semibold">{t.error.title}</h1>
      <p className="mt-2 text-sm text-foreground-soft">
        {t.error.body}
      </p>
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={retry}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
        >
          {t.error.retry}
        </button>
        {/* A plain anchor, not next/link — this boundary is rendering because
            something in the client already broke, so its router state can't
            be trusted to actually perform a client-side transition. A real
            <a> forces a full navigation that always recovers, matching
            Next.js's own guidance for error.tsx "go home" links. */}
        <a href="/home" className="rounded-lg border border-line px-4 py-2 text-sm font-medium">
          {t.error.home}
        </a>
      </div>
    </div>
  );
}
