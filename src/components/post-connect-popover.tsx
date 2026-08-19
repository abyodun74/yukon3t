"use client";

import { useEffect, useRef, useState } from "react";
import { UserPlus } from "lucide-react";
import { ConnectButton } from "@/components/connect-button";
import { cn } from "@/lib/utils";

type ConnectionStatus = "PENDING" | "ACCEPTED" | "DECLINED" | null;

/**
 * Icon-triggered wrapper around the existing ConnectButton (used as-is on
 * the profile page) so a post card can offer the same Connection-request
 * flow — intent-tag picker and PENDING/ACCEPTED status branching included —
 * without duplicating that logic. Same click-outside-to-close pattern as
 * PostOptionsMenu.
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
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
        <div className="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-line bg-surface p-3 shadow-lg">
          <ConnectButton
            targetId={targetId}
            openToIntents={openToIntents}
            status={status}
            isRequester={isRequester}
            conversationId={conversationId}
          />
        </div>
      )}
    </div>
  );
}
