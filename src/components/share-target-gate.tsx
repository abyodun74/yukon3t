"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Send, SquarePen, CirclePlus, Clapperboard, X } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { checkForPendingShare, type PendingShareMedia } from "@/lib/share-receiver";
import { setPendingShareMedia } from "@/lib/share-target-store";
import { getMyConversationsForShare, sendMessage } from "@/app/actions/messages";
import { createPost } from "@/app/actions/circles";
import { createStory } from "@/app/actions/stories";
import { createMuse } from "@/app/actions/muse";
import { uploadFileDirect, captureVideoFrameFromFile } from "@/lib/upload-client";
import { UserAvatar } from "@/components/user-link";

// Duplicated from storage.ts's server-only constants (same pattern as
// share-modal.tsx/muse-share-modal.tsx's own duplicates of these) — a Story
// video tops out at 2 minutes, a Muse at 3.
const MAX_STORY_VIDEO_SECONDS = 120;
const MAX_MUSE_VIDEO_DURATION_SECONDS = 180;

type Conversation = { id: string; label: string; avatarUrl: string | null };
type View = "root" | "friends";
type Status = "idle" | "busy" | "done" | "error";

/**
 * Drops any http(s) link out of shared text before it's used as a public
 * post/story/Muse caption — the whole point of this feature is handing over
 * the actual photo/video Instagram/TikTok/etc. attached, not the bare link
 * those apps' own "Share" action often tacks on alongside it (or, for an
 * app that only ever shares a link with nothing attached, in place of real
 * media). Left untouched for a DM (sendToFriend below) — a link is normal,
 * expected content there. Returns "" (not the original text) when nothing
 * but a link remains, so callers can tell "had a real caption" apart from
 * "was just a link" without a second check.
 */
function stripLinks(text: string | null): string {
  if (!text) return "";
  return text
    .replace(/\bhttps?:\/\/\S+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

type UploadedMedia =
  | { mediaType: "NONE"; mediaUrls: [] }
  | { mediaType: "IMAGE"; mediaUrls: string[] }
  | { mediaType: "VIDEO"; mediaUrls: []; videoUrl: string; videoThumbnailUrl?: string; videoDurationSeconds?: number };

function uploadErrorMessage(code: string) {
  switch (code) {
    case "too_large":
      return "That file is too large.";
    case "not_configured":
      return "Media uploads aren't set up yet.";
    case "stale_deployment":
      return "This app needs an update — reopen it and try again.";
    default:
      return "Couldn't upload that — check your connection and try again.";
  }
}

function publishErrorMessage(code: string) {
  switch (code) {
    case "moderation":
      return "That didn't pass our content guidelines and wasn't posted.";
    case "too_large":
      return "That file is too large.";
    case "rate_limited":
      return "You're posting too fast — slow down a little.";
    case "not_a_member":
    case "blocked":
      return "Couldn't send to that conversation.";
    default:
      return "Couldn't post — try again.";
  }
}

function probeVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.src = url;
    probe.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(probe.duration) ? Math.round(probe.duration) : null);
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
  });
}

/**
 * Root-mounted (src/app/layout.tsx), Android and iOS — the incoming half of
 * the Share-target feature: another app's Share sheet ("Share to YuKon3t")
 * launches or resumes this app with an ACTION_SEND/SEND_MULTIPLE intent,
 * MainActivity stashes it (see its handleShareIntent), and
 * checkForPendingShare() below reads/consumes it exactly once per launch.
 * iOS reaches the same component via its own Share Extension + App Group
 * hand-off — see ios/ShareExtension and ShareReceiverPlugin.swift — with
 * checkForPendingShare() branching on platform so everything from here down
 * is already shared between both.
 *
 * Picking a destination (Story / Muse / Feed / a friend) uploads the shared
 * media and publishes to it immediately — no separate "review in the
 * composer, then tap Post" step. The moderation gate each of
 * createStory/createMuse/createPost/sendMessage already runs server-side is
 * what's actually standing in for a manual review step here; picking the
 * destination is itself the user's explicit confirmation to publish there,
 * same as tapping "Post" always was, just merged into one action instead
 * of two. The one exception: createPost's own device-verification gate
 * (src/lib/device-trust.ts) needs a real code-entry UI that already lives
 * in post-composer.tsx — on that specific response this falls back to the
 * old "hand off to the composer" path rather than duplicating it here.
 *
 * Story/Muse/Feed captions all run through stripLinks() first — see its own
 * doc comment for why a link tagging along with real media shouldn't end up
 * in a public caption. A share that never actually carried a photo/video
 * (the source app only sent a link) can't produce one at all — Feed/Story/
 * Muse are hidden and a notice explains why, but "Send to a friend" stays
 * available since forwarding a link privately is still useful.
 */
export function ShareTargetGate({ userId }: { userId: string }) {
  const router = useRouter();
  const [share, setShare] = useState<PendingShareMedia | null>(null);
  const [view, setView] = useState<View>("root");
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [videoDurationSeconds, setVideoDurationSeconds] = useState<number | null>(null);
  const uploadCacheRef = useRef<UploadedMedia | null>(null);

  useEffect(() => {
    const platform = Capacitor.getPlatform();
    if (platform !== "android" && platform !== "ios") return;
    let cancelled = false;
    let listener: { remove: () => void } | undefined;

    function check() {
      checkForPendingShare().then((result) => {
        if (cancelled || !result) return;
        setShare(result);
      });
    }

    check();
    import("@capacitor/app").then(({ App }) => {
      if (cancelled) return;
      App.addListener("resume", check).then((h) => {
        if (cancelled) h.remove();
        else listener = h;
      });
    });

    return () => {
      cancelled = true;
      listener?.remove();
    };
  }, []);

  useEffect(() => {
    if (view === "friends" && conversations === null) {
      getMyConversationsForShare().then((r) => setConversations(r.conversations));
    }
  }, [view, conversations]);

  const previewUrl = useMemo(() => {
    const first = share?.images[0] ?? share?.video ?? null;
    return first ? URL.createObjectURL(first) : null;
  }, [share]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Needed up front (before ensureUploaded ever runs) to decide whether
  // "Add to your story"/"Post to Muse" even show at all — Story and Muse
  // each have their own duration ceiling, same as share-modal.tsx/
  // muse-share-modal.tsx's own canShareToStory/canShareToMuse checks for an
  // already-posted video, just probed client-side here since a freshly
  // shared file's duration isn't known any other way yet.
  useEffect(() => {
    // No reset-to-null branch for the no-video case: initial state is
    // already null, and close() (below) resets it whenever a share is
    // dismissed — a mounted share never actually swaps from a video to a
    // different, non-video one in place (checkForPendingShare only ever
    // hands over one share per mount), so there's nothing to reset here.
    if (!share?.video) return;
    let cancelled = false;
    probeVideoDuration(share.video).then((d) => {
      if (!cancelled) setVideoDurationSeconds(d);
    });
    return () => {
      cancelled = true;
    };
  }, [share]);

  if (!share) return null;
  const hasMedia = share.images.length > 0 || Boolean(share.video);
  // A duration probe failure fails open (same reasoning as story-upload-
  // modal.tsx's own probe) — an unknown duration doesn't block sharing.
  const canShareToStory =
    hasMedia && (!share.video || videoDurationSeconds === null || videoDurationSeconds <= MAX_STORY_VIDEO_SECONDS);
  const canShareToMuse =
    Boolean(share.video) && videoDurationSeconds !== null && videoDurationSeconds <= MAX_MUSE_VIDEO_DURATION_SECONDS;

  function close() {
    setShare(null);
    setView("root");
    setConversations(null);
    setStatus("idle");
    setErrorText(null);
    setVideoDurationSeconds(null);
    uploadCacheRef.current = null;
  }

  // Uploads whatever media this share carries, once — "Post to Feed",
  // "Add to your story", and each friend in the list all need the same
  // uploaded URL(s), and bouncing between options (open the friend list,
  // go back, try Feed instead) shouldn't re-upload the same file twice.
  // Always uses the "post-*" upload kinds regardless of the eventual
  // destination — post/message/story share the exact same size caps for
  // both image and video (see storage.ts's MEDIA_LIMITS), so one upload is
  // valid to hand to any of the three actions below.
  async function ensureUploaded(): Promise<{ ok: true; media: UploadedMedia } | { ok: false; error: string }> {
    if (uploadCacheRef.current) return { ok: true, media: uploadCacheRef.current };
    if (!hasMedia) {
      const media: UploadedMedia = { mediaType: "NONE", mediaUrls: [] };
      uploadCacheRef.current = media;
      return { ok: true, media };
    }
    if (share!.video) {
      const [videoResult, thumbnailResult, duration] = await Promise.all([
        uploadFileDirect(share!.video, "post-video"),
        captureVideoFrameFromFile(share!.video).then((frame) => (frame ? uploadFileDirect(frame, "video-thumb") : null)),
        probeVideoDuration(share!.video),
      ]);
      if (!videoResult.ok) return { ok: false, error: videoResult.error };
      const media: UploadedMedia = {
        mediaType: "VIDEO",
        mediaUrls: [],
        videoUrl: videoResult.publicUrl,
        videoThumbnailUrl: thumbnailResult?.ok ? thumbnailResult.publicUrl : undefined,
        videoDurationSeconds: duration ?? undefined,
      };
      uploadCacheRef.current = media;
      return { ok: true, media };
    }
    const uploaded = await Promise.all(share!.images.map((f) => uploadFileDirect(f, "post-image")));
    const failed = uploaded.find((u) => !u.ok);
    if (failed && !failed.ok) return { ok: false, error: failed.error };
    const media: UploadedMedia = {
      mediaType: "IMAGE",
      mediaUrls: uploaded.map((u) => (u.ok ? u.publicUrl : "")).filter(Boolean),
    };
    uploadCacheRef.current = media;
    return { ok: true, media };
  }

  async function publishToFeed() {
    setStatus("busy");
    setErrorText(null);
    const uploaded = await ensureUploaded();
    if (!uploaded.ok) {
      setStatus("error");
      setErrorText(uploadErrorMessage(uploaded.error));
      return;
    }
    const fd = new FormData();
    fd.set("content", stripLinks(share!.text));
    fd.set("mediaType", uploaded.media.mediaType);
    fd.set("mediaUrls", JSON.stringify(uploaded.media.mediaUrls));
    if (uploaded.media.mediaType === "VIDEO") {
      fd.set("videoUrl", uploaded.media.videoUrl);
      if (uploaded.media.videoThumbnailUrl) fd.set("videoThumbnailUrl", uploaded.media.videoThumbnailUrl);
      if (uploaded.media.videoDurationSeconds) fd.set("videoDurationSeconds", String(uploaded.media.videoDurationSeconds));
    }
    const result = await createPost(fd);
    if (result.error === "device_verification_required") {
      // Rare (a genuinely new/unrecognized device) — hand off to the full
      // composer, which already has its own emailed-code entry UI
      // (post-composer.tsx), instead of duplicating that here.
      setPendingShareMedia(share!);
      close();
      router.push(`/u/${userId}?compose=1`);
      return;
    }
    if (result.error) {
      setStatus("error");
      setErrorText(publishErrorMessage(result.error));
      return;
    }
    setStatus("done");
    router.push("/home");
    router.refresh();
    setTimeout(close, 500);
  }

  async function sendToFriend(conversationId: string) {
    setStatus("busy");
    setErrorText(null);
    const uploaded = await ensureUploaded();
    if (!uploaded.ok) {
      setStatus("error");
      setErrorText(uploadErrorMessage(uploaded.error));
      return;
    }
    const fd = new FormData();
    fd.set("conversationId", conversationId);
    fd.set("content", share!.text ?? "");
    fd.set("mediaType", uploaded.media.mediaType);
    // Messages take a single mediaUrl, not an array — a multi-image share
    // only ever sends the first image to a DM, same one-attachment-per-
    // message shape chat-thread.tsx's own composer already has.
    if (uploaded.media.mediaType === "IMAGE" && uploaded.media.mediaUrls[0]) {
      fd.set("mediaUrl", uploaded.media.mediaUrls[0]);
    } else if (uploaded.media.mediaType === "VIDEO") {
      fd.set("mediaUrl", uploaded.media.videoUrl);
      if (uploaded.media.videoThumbnailUrl) fd.set("mediaThumbnailUrl", uploaded.media.videoThumbnailUrl);
    }
    const result = await sendMessage(fd);
    if (result.error) {
      setStatus("error");
      setErrorText(publishErrorMessage(result.error));
      return;
    }
    setStatus("done");
    router.push(`/messages/${conversationId}`);
    setTimeout(close, 500);
  }

  async function addToStory() {
    setStatus("busy");
    setErrorText(null);
    const uploaded = await ensureUploaded();
    if (!uploaded.ok) {
      setStatus("error");
      setErrorText(uploadErrorMessage(uploaded.error));
      return;
    }
    if (uploaded.media.mediaType === "NONE") {
      setStatus("error");
      setErrorText("Stories need a photo or video.");
      return;
    }
    const fd = new FormData();
    fd.set("mediaType", uploaded.media.mediaType);
    fd.set("mediaUrl", uploaded.media.mediaType === "VIDEO" ? uploaded.media.videoUrl : uploaded.media.mediaUrls[0]);
    if (uploaded.media.mediaType === "VIDEO" && uploaded.media.videoThumbnailUrl) {
      fd.set("mediaThumbnailUrl", uploaded.media.videoThumbnailUrl);
    }
    // storySchema caps captions at 200 chars (unlike post/message content,
    // which allow far more) — truncate rather than let a longer shared
    // caption fail the whole story with a generic "invalid" error, since
    // the point of this flow is that picking a destination is supposed to
    // just work, not surface a validation error with no way to edit it.
    const caption = stripLinks(share!.text);
    if (caption) fd.set("caption", caption.slice(0, 200));
    const result = await createStory(fd);
    if (result.error) {
      setStatus("error");
      setErrorText(publishErrorMessage(result.error));
      return;
    }
    setStatus("done");
    router.push("/home");
    router.refresh();
    setTimeout(close, 500);
  }

  async function postToMuse() {
    setStatus("busy");
    setErrorText(null);
    const uploaded = await ensureUploaded();
    if (!uploaded.ok) {
      setStatus("error");
      setErrorText(uploadErrorMessage(uploaded.error));
      return;
    }
    if (uploaded.media.mediaType !== "VIDEO") {
      setStatus("error");
      setErrorText("Muse needs a video.");
      return;
    }
    const fd = new FormData();
    fd.set("videoUrl", uploaded.media.videoUrl);
    if (uploaded.media.videoThumbnailUrl) fd.set("videoThumbnailUrl", uploaded.media.videoThumbnailUrl);
    if (uploaded.media.videoDurationSeconds) fd.set("videoDurationSeconds", String(uploaded.media.videoDurationSeconds));
    const caption = stripLinks(share!.text);
    if (caption) fd.set("caption", caption);
    const result = await createMuse(fd);
    if (result.error) {
      setStatus("error");
      setErrorText(publishErrorMessage(result.error));
      return;
    }
    setStatus("done");
    router.push("/muse");
    router.refresh();
    setTimeout(close, 500);
  }

  const busy = status === "busy";
  const linkOnly = !hasMedia && Boolean(share.text);

  return (
    <div
      className="animate-modal-backdrop-in fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      onClick={busy ? undefined : close}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="animate-modal-panel-in w-full max-w-sm rounded-xl bg-surface p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {view === "root" ? "Share to YuKon3t" : "Send to a friend"}
          </h2>
          {!busy && (
            <button type="button" onClick={close} aria-label="Close" className="text-foreground-soft hover:text-danger">
              <X size={18} />
            </button>
          )}
        </div>

        {previewUrl &&
          (share.video ? (
            <video src={previewUrl} className="mt-3 max-h-48 w-full rounded-lg bg-black object-contain" controls />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- a transient blob: URL, not a real asset next/image can optimize
            <img src={previewUrl} alt="" className="mt-3 max-h-48 w-full rounded-lg object-contain" />
          ))}

        {linkOnly && (
          <p className="mt-3 rounded-lg bg-background px-3 py-2 text-xs text-foreground-soft">
            That app only shared a link, not the actual photo or video — YuKon3t needs the real
            file. Try &ldquo;Save&rdquo;/&ldquo;Download&rdquo; in that app first, then share
            again, or just send the link to a friend below.
          </p>
        )}
        {share.skipped > 0 && (
          <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
            {share.skipped === 1 ? "One item" : `${share.skipped} items`} couldn&apos;t be
            included (too large, or not a supported photo/video type).
          </p>
        )}

        {errorText && <p className="mt-3 text-xs text-danger">{errorText}</p>}
        {status === "busy" && <p className="mt-3 text-xs text-foreground-soft">Posting…</p>}
        {status === "done" && <p className="mt-3 text-xs text-success">Posted!</p>}

        {view === "root" && (
          <div className="mt-3 space-y-1">
            {canShareToStory && (
              <button
                type="button"
                onClick={addToStory}
                disabled={busy}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-line/60 disabled:opacity-50"
              >
                <CirclePlus size={16} />
                Add to your story
              </button>
            )}
            {canShareToMuse && (
              <button
                type="button"
                onClick={postToMuse}
                disabled={busy}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-line/60 disabled:opacity-50"
              >
                <Clapperboard size={16} />
                Post to Muse
              </button>
            )}
            {hasMedia && (
              <button
                type="button"
                onClick={publishToFeed}
                disabled={busy}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-line/60 disabled:opacity-50"
              >
                <SquarePen size={16} />
                Post to Feed
              </button>
            )}
            <button
              type="button"
              onClick={() => setView("friends")}
              disabled={busy}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-line/60 disabled:opacity-50"
            >
              <Send size={16} />
              Send to a friend
            </button>
          </div>
        )}

        {view === "friends" && (
          <>
            <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto">
              {conversations === null && <li className="px-2 py-1 text-sm text-foreground-soft">Loading…</li>}
              {conversations?.length === 0 && (
                <li className="px-2 py-1 text-sm text-foreground-soft">No conversations yet.</li>
              )}
              {conversations?.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => sendToFriend(c.id)}
                    disabled={busy}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-line/60 disabled:opacity-50"
                  >
                    <UserAvatar avatarUrl={c.avatarUrl} name={c.label} size={26} />
                    <span className="truncate">{c.label}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setView("root")}
              disabled={busy}
              className="mt-3 text-xs text-foreground-soft hover:text-accent disabled:opacity-50"
            >
              ← Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
