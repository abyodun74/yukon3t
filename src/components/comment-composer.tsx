"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { createComment } from "@/app/actions/comments";
import { GifPickerButton } from "@/components/gif-picker-button";

function errorMessage(code: string) {
  switch (code) {
    case "rate_limited":
      return "You're commenting too fast — slow down a little.";
    case "invalid":
      return "Couldn't post that comment — try again.";
    default:
      return "Couldn't post — try again.";
  }
}

export function CommentComposer({
  postId,
  parentId,
  onDone,
}: {
  postId: string;
  parentId?: string;
  onDone?: () => void;
}) {
  const [content, setContent] = useState("");
  const [pendingGif, setPendingGif] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="mt-2"
      action={() => {
        const trimmed = content.trim();
        if (!trimmed && !pendingGif) return;
        const fd = new FormData();
        fd.set("postId", postId);
        if (parentId) fd.set("parentId", parentId);
        fd.set("content", trimmed);
        if (pendingGif) fd.set("gifUrl", pendingGif);
        startTransition(async () => {
          const result = await createComment(fd);
          if (result.error) {
            setErrorText(errorMessage(result.error));
            return;
          }
          setContent("");
          setPendingGif(null);
          setErrorText(null);
          router.refresh();
          onDone?.();
        });
      }}
    >
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={1000}
        rows={2}
        placeholder={parentId ? "Write a reply..." : "Write a comment..."}
        className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent"
      />
      {pendingGif && (
        <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
          {/* eslint-disable-next-line @next/next/no-img-element -- Tenor-hosted preview, not a local/optimizable asset */}
          <img src={pendingGif} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
          <span className="flex-1 truncate">GIF attached</span>
          <button type="button" onClick={() => setPendingGif(null)} className="text-danger">
            <X size={14} />
          </button>
        </div>
      )}
      <div className="mt-1.5 flex items-center gap-2">
        <GifPickerButton onSelect={setPendingGif} />
        <button
          type="submit"
          disabled={isPending || (content.trim().length === 0 && !pendingGif)}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50"
        >
          {parentId ? "Reply" : "Comment"}
        </button>
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className="text-xs text-foreground-soft"
          >
            Cancel
          </button>
        )}
      </div>
      {errorText && <p className="mt-1 text-xs text-danger">{errorText}</p>}
    </form>
  );
}
