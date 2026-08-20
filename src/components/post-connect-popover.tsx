"use client";

import { useState } from "react";
import { UserPlus, X } from "lucide-react";
import { ConnectButton } from "@/components/connect-button";
import { cn } from "@/lib/utils";

type ConnectionStatus = "PENDING" | "ACCEPTED" | "DECLINED" | null;

/**
 * Icon-triggered wrapper around the existing ConnectButton (used as-is on
 * the profile page) so a post card can offer the same Connection-request
 * flow — intent-tag picker and PENDING/ACCEPTED status branching included —
 * without duplicating that logic.
 *
 * Renders as a centered fixed modal (same fixed inset-0/bg-black/60 pattern
 * as ShareModal/ReportModal), not an anchored dropdown — an absolute-
 * positioned dropdown here previously overflowed off the left edge of the
 * screen and rendered on top of the next post card on narrow/mobile
 * viewports, since the trigger icon sits mid-row rather than at a card
 * corner with guaranteed space to expand into.
 */
export function PostConnectPopover({
  targetId,
  openToIntents,
  status,
  isRequester,
  conversationId,
}: {
  targetId: string;
  openToIntents: string[];
  status: ConnectionStatus;
  isRequester: boolean;
  conversationId: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Connect"
        title="Connect"
        className={cn(
          "flex items-center hover:text-accent",
          (status === "ACCEPTED" || status === "PENDING") && "text-accent",
        )}
      >
        <UserPlus size={16} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-sm rounded-xl bg-surface p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Connect</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-foreground-soft hover:text-danger"
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-3">
              <ConnectButton
                targetId={targetId}
                openToIntents={openToIntents}
                status={status}
                isRequester={isRequester}
                conversationId={conversationId}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
