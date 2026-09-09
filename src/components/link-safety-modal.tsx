"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, X } from "lucide-react";
import { checkLinkBeforeOpen } from "@/app/actions/link-safety";
import { cn } from "@/lib/utils";

/**
 * Shown before following any post's shared link, instead of navigating
 * straight there. Always makes the actual destination domain unmissable —
 * the single biggest defense against a lookalike/spoofed domain, and the
 * one thing this can guarantee even with no scanning API configured —
 * plus a real-time Safe Browsing check layered on top when
 * GOOGLE_SAFE_BROWSING_API_KEY is set (see src/lib/link-safety.ts for why
 * this is checked fresh here rather than once when the post was created).
 * Never fully blocks navigation on a flag — an automated scan can
 * false-positive, so the decision to proceed anyway has to stay the
 * viewer's, just an informed one instead of an invisible one.
 */
export function LinkSafetyModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [status, setStatus] = useState<"checking" | "safe" | "flagged" | "unknown">("checking");

  let domain = url;
  try {
    domain = new URL(url).hostname;
  } catch {
    // Malformed URL slipped through somehow — fall back to showing the raw string.
  }

  useEffect(() => {
    let cancelled = false;
    checkLinkBeforeOpen(url).then((result) => {
      if (!cancelled) setStatus(result.status);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  function proceed() {
    window.open(url, "_blank", "noopener,noreferrer");
    onClose();
  }

  return (
    <div
      className="animate-modal-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="animate-modal-panel-in w-full max-w-sm rounded-xl bg-surface p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Leaving YuKon3t</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 -m-2 text-foreground-soft hover:text-danger"
          >
            <X size={18} />
          </button>
        </div>

        <p className="mt-3 flex items-center gap-2 break-all rounded-lg border border-line bg-background px-3 py-2 text-sm">
          <ExternalLink size={14} className="shrink-0 text-foreground-soft" />
          {domain}
        </p>

        {status === "checking" && (
          <p className="mt-2 text-xs text-foreground-soft">Checking link safety…</p>
        )}
        {status === "flagged" && (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            This link was flagged as potentially unsafe by an automated scan. Continue only if you trust it.
          </p>
        )}
        {status === "safe" && (
          <p className="mt-2 text-xs text-success">No known threats found.</p>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={proceed}
            className={cn(
              "flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold",
              status === "flagged" ? "bg-danger text-white" : "bg-accent text-accent-ink",
            )}
          >
            {status === "flagged" ? "Continue anyway" : "Continue"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-4 py-2.5 text-sm font-medium hover:border-accent hover:text-accent"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
