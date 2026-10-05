"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { checkLinkBeforeOpen } from "@/app/actions/link-safety";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/sheet";

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
/**
 * Migrated onto the shared Sheet component (see that file) — the caller
 * now renders this unconditionally once `open` has ever been true (Sheet's
 * AnimatePresence needs it mounted through its own exit animation), so the
 * Safe Browsing check below is now explicitly gated on `open` itself rather
 * than firing once on an unconditional mount — otherwise every post with a
 * link would trigger a scan the instant the feed rendered it, not when the
 * viewer actually taps through.
 */
export function LinkSafetyModal({ url, open, onClose }: { url: string; open: boolean; onClose: () => void }) {
  const [status, setStatus] = useState<"checking" | "safe" | "flagged" | "unknown">("checking");

  let domain = url;
  try {
    domain = new URL(url).hostname;
  } catch {
    // Malformed URL slipped through somehow — fall back to showing the raw string.
  }

  // Resets to "checking" and re-runs the scan every time this reopens —
  // adjusted during render (React's documented pattern for this, same as
  // report-form.tsx's own wasOpen check) rather than inside the effect
  // below, which this project's lint config flags for a synchronous
  // setState call at the top of an effect body.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setStatus("checking");
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    checkLinkBeforeOpen(url).then((result) => {
      if (!cancelled) setStatus(result.status);
    });
    return () => {
      cancelled = true;
    };
  }, [url, open]);

  function proceed() {
    window.open(url, "_blank", "noopener,noreferrer");
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Leaving YuKon3t">
      <p className="flex items-center gap-2 break-all rounded-lg border border-line bg-background px-3 py-2 text-sm">
        <ExternalLink size={14} className="shrink-0 text-foreground-soft" />
        {domain}
      </p>

      {status === "checking" && <p className="mt-2 text-xs text-foreground-soft">Checking link safety…</p>}
      {status === "flagged" && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          This link was flagged as potentially unsafe by an automated scan. Continue only if you trust it.
        </p>
      )}
      {status === "safe" && <p className="mt-2 text-xs text-success">No known threats found.</p>}

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
    </Sheet>
  );
}
