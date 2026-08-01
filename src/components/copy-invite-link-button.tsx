"use client";

import { useState } from "react";
import { Link2, Check } from "lucide-react";

export function CopyInviteLinkButton({ conversationId }: { conversationId: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    const url = `${window.location.origin}/messages/${conversationId}`;
    try {
      await navigator.clipboard.writeText(url);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
    setTimeout(() => setStatus("idle"), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-foreground-soft hover:border-accent hover:text-accent"
    >
      {status === "copied" ? <Check size={13} /> : <Link2 size={13} />}
      {status === "copied" ? "Copied!" : status === "failed" ? "Couldn't copy" : "Copy invite link"}
    </button>
  );
}
