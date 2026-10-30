"use client";

import { useState } from "react";
import { Link2, Check } from "lucide-react";
import { useMessagesText } from "@/components/messages-text";
import { copyTextToClipboard } from "@/lib/copy-image";

export function CopyInviteLinkButton({ conversationId }: { conversationId: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const t = useMessagesText().t.group;

  async function copy() {
    const url = `${window.location.origin}/messages/${conversationId}`;
    setStatus((await copyTextToClipboard(url)) ? "copied" : "failed");
    setTimeout(() => setStatus("idle"), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-foreground-soft hover:border-accent hover:text-accent"
    >
      {status === "copied" ? <Check size={13} /> : <Link2 size={13} />}
      {status === "copied" ? t.copied : status === "failed" ? t.copyFailed : t.copyLink}
    </button>
  );
}
