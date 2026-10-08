"use client";

import { useEffect, useState, useTransition } from "react";
import { Link as LinkIcon, Share as ShareIcon, Send, CirclePlus, House } from "lucide-react";
import { UserAvatar } from "@/components/user-link";
import { Skeleton } from "@/components/skeleton";
import { recordMuseShare, shareMuseToStory } from "@/app/actions/muse";
import { getMyConversationsForShare, shareMuseToConversation } from "@/app/actions/messages";
import { canShareNatively, shareNative } from "@/lib/native-share";
import { resolveBrandedVideoUrl } from "@/lib/branded-video-client";
import { Sheet } from "@/components/sheet";
import { announce } from "@/lib/announce";

// A Story only takes a clip up to this long (storage.ts MAX_STORY_VIDEO_SECONDS — duplicated because that file is
// server-only); a longer Muse can still go to Home, a friend, or anywhere via the device share sheet.
const MAX_STORY_VIDEO_SECONDS = 120;

type Conversation = { id: string; label: string; avatarUrl: string | null };

/** Fetches the video into a File the Web Share API can attach — best effort, never throws (null on any failure: CORS, network). */
async function fetchAsFile(url: string, name: string): Promise<File | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new File([blob], name, { type: blob.type || "video/mp4" });
  } catch {
    return null;
  }
}

/**
 * Share sheet for a Muse. Everything here sends the actual VIDEO, not a link to it: onto your Home, into your Story,
 * to a friend as a video message, or through the device's share sheet with the file attached. "Copy link" is the one
 * exception, because a link is what it is.
 */
export function MuseShareModal({
  museId,
  caption,
  videoUrl,
  videoDurationSeconds,
  reshared,
  onToggleReshare,
  onShareCountChange,
  open,
  onClose,
}: {
  museId: string;
  caption: string | null;
  videoUrl: string;
  videoDurationSeconds: number;
  /** Whether the viewer has already put this Muse on their Home. */
  reshared: boolean;
  onToggleReshare: () => Promise<void> | void;
  onShareCountChange: (count: number) => void;
  open: boolean;
  onClose: () => void;
}) {
  const [view, setView] = useState<"root" | "friends">("root");
  // Sends a reopened modal back to its root screen — adjusted during
  // render (React's documented pattern for this) rather than a useEffect,
  // which this project's lint config flags for a synchronous setState call.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setView("root");
  }
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [sentToId, setSentToId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sharingViaDevice, setSharingViaDevice] = useState(false);
  const [sharingToStory, setSharingToStory] = useState(false);
  const [sharedToStory, setSharedToStory] = useState(false);
  const [sharingToHome, setSharingToHome] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const canShareToStory = videoDurationSeconds <= MAX_STORY_VIDEO_SECONDS;
  const url = typeof window !== "undefined" ? `${window.location.origin}/muse/${museId}` : "";
  const canNativeShare = canShareNatively() || (typeof navigator !== "undefined" && "share" in navigator);

  useEffect(() => {
    if (view === "friends" && conversations === null) {
      getMyConversationsForShare().then((r) => setConversations(r.conversations));
    }
  }, [view, conversations]);

  function countShare() {
    startTransition(async () => {
      const result = await recordMuseShare(museId);
      if (!result.error && result.shareCount !== undefined) onShareCountChange(result.shareCount);
    });
  }

  function copyLink() {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        countShare();
      })
      .catch(() => setNotice("Couldn't copy the link."));
  }

  async function shareViaDevice() {
    setNotice(null);
    setSharingViaDevice(true);
    try {
      // Bakes the yukon3t brand mark into the actual video file server-side
      // (see branded-video-client.ts) — the video counterpart to
      // watermark.ts's client-side canvas stamp for a still image. Resolves
      // to the original, unwatermarked URL if Cloudflare Stream can't
      // produce a branded copy within a short wait, so a share is never
      // blocked or degraded over this.
      const brandedVideoUrl = await resolveBrandedVideoUrl(videoUrl);

      if (canShareNatively()) {
        const result = await shareNative({
          url,
          text: caption ?? undefined,
          sources: [{ src: brandedVideoUrl, fileName: `muse-${museId}.mp4`, watermark: false }],
        });
        if (result.warning) setNotice(result.warning);
        countShare();
        return;
      }
      const data: ShareData = { url, text: caption ?? undefined };
      // Attach the actual video so WhatsApp / SMS / etc. receive it, not a bare link. Needs the file to be fetchable
      // from the browser (storage CORS) and the browser to support sharing files; otherwise it falls back to text+link.
      const file = await fetchAsFile(brandedVideoUrl, `muse-${museId}.mp4`);
      if (file && navigator.canShare?.({ files: [file] })) {
        data.files = [file];
      } else {
        setNotice("Couldn't attach the video here, so only the link was shared.");
      }
      try {
        await navigator.share(data);
        countShare();
      } catch {
        /* cancelled */
      }
    } finally {
      setSharingViaDevice(false);
    }
  }

  function shareToHome() {
    if (sharingToHome || reshared) return;
    setSharingToHome(true);
    Promise.resolve(onToggleReshare()).finally(() => setSharingToHome(false));
  }

  function shareToStory() {
    if (sharingToStory || sharedToStory) return;
    setNotice(null);
    setSharingToStory(true);
    startTransition(async () => {
      const result = await shareMuseToStory(museId);
      setSharingToStory(false);
      if (result.error) {
        setNotice(
          result.error === "too_long"
            ? "This Muse is too long for a Story."
            : result.error === "rate_limited"
              ? "Slow down a little and try again."
              : "Couldn't add it to your story.",
        );
        return;
      }
      setSharedToStory(true);
      if (result.shareCount !== undefined) onShareCountChange(result.shareCount);
    });
  }

  function sendToFriend(conversationId: string) {
    setNotice(null);
    startTransition(async () => {
      const result = await shareMuseToConversation(museId, conversationId);
      if (result.error) {
        setNotice(result.error === "blocked" ? "You can't message this person." : "Couldn't send it.");
        return;
      }
      setSentToId(conversationId);
      announce("Sent");
      if (result.shareCount !== undefined) onShareCountChange(result.shareCount);
    });
  }

  return (
    // relative + z-[60] (not Sheet's own default z-50) establishes a new
    // stacking context at that level — this needs to sit above the Muse
    // feed's own overlays (e.g. its toast at z-[55]), same stacking-context
    // nesting trick used wherever else in the app a fixed-position overlay
    // needs a non-default layer without Sheet itself needing a z-index prop.
    <div className="relative z-[60]">
      <Sheet open={open} onClose={onClose} title={view === "root" ? "Share Muse" : "Send to a friend"}>
        {notice && <p role="alert" className="break-words rounded-lg bg-danger/10 px-2 py-1.5 text-xs text-danger">{notice}</p>}

        {view === "root" && (
          <div className="mt-3 space-y-1">
            <button
              type="button"
              disabled={sharingToHome || reshared}
              onClick={shareToHome}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-line/60 disabled:opacity-60"
            >
              <House size={16} />
              {reshared ? "On your Home" : sharingToHome ? "Sharing…" : "Share to your Home"}
            </button>
            {canShareToStory && (
              <button
                type="button"
                disabled={sharingToStory || sharedToStory}
                onClick={shareToStory}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-line/60 disabled:opacity-60"
              >
                <CirclePlus size={16} />
                {sharedToStory ? "Added to your story" : sharingToStory ? "Adding…" : "Share to your story"}
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
            {canNativeShare && (
              <button
                type="button"
                disabled={sharingViaDevice}
                onClick={shareViaDevice}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-line/60 disabled:opacity-60"
              >
                <ShareIcon size={16} />
                {sharingViaDevice ? "Preparing…" : "Share via device"}
              </button>
            )}
            <button
              type="button"
              onClick={copyLink}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-line/60"
            >
              <LinkIcon size={16} />
              {copied ? "Link copied" : "Copy link"}
            </button>
          </div>
        )}

        {view === "friends" && (
          <div className="mt-3">
            <button type="button" onClick={() => setView("root")} className="mb-2 text-xs text-accent hover:underline">
              ← Back
            </button>
            <ul className="max-h-64 overflow-y-auto">
              {conversations === null && (
                <>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <li key={i} className="flex items-center gap-2 px-2 py-2">
                      <Skeleton className="h-[26px] w-[26px] rounded-full" />
                      <Skeleton className="h-3 w-32" />
                    </li>
                  ))}
                </>
              )}
              {conversations?.length === 0 && (
                <li className="px-2 py-3 text-sm text-foreground-soft">No conversations yet.</li>
              )}
              {conversations?.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={sentToId === c.id}
                    onClick={() => sendToFriend(c.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-line/60 disabled:opacity-60"
                  >
                    <UserAvatar avatarUrl={c.avatarUrl} name={c.label} size={26} />
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    {sentToId === c.id && <span className="text-xs text-success">Sent</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Sheet>
    </div>
  );
}
