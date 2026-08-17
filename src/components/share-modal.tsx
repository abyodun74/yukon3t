"use client";

import { useEffect, useState, useTransition } from "react";
import { X, Link as LinkIcon, Share as ShareIcon, Send, Users } from "lucide-react";
import { UserAvatar } from "@/components/user-link";
import { recordShare, shareToCircle } from "@/app/actions/shares";
import { sendMessage, getMyConversationsForShare } from "@/app/actions/messages";
import { getMyCircles } from "@/app/actions/circles";

type Conversation = { id: string; label: string; avatarUrl: string | null };
type Circle = { id: string; name: string; slug: string; coverImageUrl: string | null };

type View = "root" | "friends" | "circles";

/** Share destinations for a post — copy link, native device share, send to a friend (DM), or share into a Circle. */
export function ShareModal({
  postId,
  onClose,
  onShareCountChange,
}: {
  postId: string;
  onClose: () => void;
  onShareCountChange: (count: number) => void;
}) {
  const [view, setView] = useState<View>("root");
  const [copied, setCopied] = useState(false);
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [circles, setCircles] = useState<Circle[] | null>(null);
  const [sentToId, setSentToId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const url = typeof window !== "undefined" ? `${window.location.origin}/post/${postId}` : "";
  const canNativeShare = typeof navigator !== "undefined" && "share" in navigator;

  useEffect(() => {
    if (view === "friends" && conversations === null) {
      getMyConversationsForShare().then((r) => setConversations(r.conversations));
    }
    if (view === "circles" && circles === null) {
      getMyCircles().then((r) => setCircles(r.circles));
    }
  }, [view, conversations, circles]);

  function bumpShareCount() {
    startTransition(async () => {
      const result = await recordShare(postId);
      if (!result.error && result.shareCount !== undefined) {
        onShareCountChange(result.shareCount);
      }
    });
  }

  function copyLink() {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
    bumpShareCount();
  }

  function nativeShare() {
    navigator.share({ url }).then(bumpShareCount).catch(() => {});
  }

  function sendToConversation(conversationId: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("conversationId", conversationId);
      fd.set("content", url);
      const result = await sendMessage(fd);
      if (!result.error) {
        setSentToId(conversationId);
        bumpShareCount();
      }
    });
  }

  function shareIntoCircle(circleId: string) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("postId", postId);
      fd.set("circleId", circleId);
      const result = await shareToCircle(fd);
      if (!result.error && result.shareCount !== undefined) {
        setSentToId(circleId);
        onShareCountChange(result.shareCount);
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-xl bg-surface p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {view === "root" ? "Share post" : view === "friends" ? "Send to a friend" : "Share to a Circle"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-foreground-soft hover:text-danger">
            <X size={18} />
          </button>
        </div>

        {view === "root" && (
          <div className="mt-3 space-y-1">
            <button
              type="button"
              onClick={copyLink}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-line/60"
            >
              <LinkIcon size={16} />
              {copied ? "Link copied" : "Copy link"}
            </button>
            {canNativeShare && (
              <button
                type="button"
                onClick={nativeShare}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-line/60"
              >
                <ShareIcon size={16} />
                Share via device
              </button>
            )}
            <button
              type="button"
              onClick={() => setView("friends")}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-line/60"
            >
              <Send size={16} />
              Send to a friend
            </button>
            <button
              type="button"
              onClick={() => setView("circles")}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-line/60"
            >
              <Users size={16} />
              Share to a Circle
            </button>
          </div>
        )}

        {view === "friends" && (
          <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto">
            {conversations === null && <li className="px-2 py-1 text-sm text-foreground-soft">Loading…</li>}
            {conversations?.length === 0 && (
              <li className="px-2 py-1 text-sm text-foreground-soft">No conversations yet.</li>
            )}
            {conversations?.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => sendToConversation(c.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm hover:bg-line/60"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <UserAvatar avatarUrl={c.avatarUrl} name={c.label} size={26} />
                    <span className="truncate">{c.label}</span>
                  </span>
                  {sentToId === c.id && <span className="shrink-0 text-xs text-success">Sent</span>}
                </button>
              </li>
            ))}
          </ul>
        )}

        {view === "circles" && (
          <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto">
            {circles === null && <li className="px-2 py-1 text-sm text-foreground-soft">Loading…</li>}
            {circles?.length === 0 && (
              <li className="px-2 py-1 text-sm text-foreground-soft">You haven't joined any Circles yet.</li>
            )}
            {circles?.map((circle) => (
              <li key={circle.id}>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => shareIntoCircle(circle.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm hover:bg-line/60"
                >
                  <span className="truncate">{circle.name}</span>
                  {sentToId === circle.id && <span className="shrink-0 text-xs text-success">Shared</span>}
                </button>
              </li>
            ))}
          </ul>
        )}

        {view !== "root" && (
          <button
            type="button"
            onClick={() => setView("root")}
            className="mt-3 text-xs text-foreground-soft hover:text-accent"
          >
            ← Back
          </button>
        )}
      </div>
    </div>
  );
}
