"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Send, SquarePen, CirclePlus, Clapperboard, Users, Hash, Lock, X } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { checkForPendingShare, type PendingShareMedia } from "@/lib/share-receiver";
import { setPendingShareMedia } from "@/lib/share-target-store";
import { getMyConversationsForShare } from "@/app/actions/messages";
import { sendToConversations } from "@/app/actions/share-to-chats";
import { createPost, getShareTargetCircles } from "@/app/actions/circles";
import { createStory } from "@/app/actions/stories";
import { createMuse } from "@/app/actions/muse";
import { uploadFileDirect, captureVideoFrameFromFile, withRetry } from "@/lib/upload-client";
import { looksLikeStaleServerActionError } from "@/lib/stale-build";
import {
  addOptimisticPost,
  removeOptimisticPost,
  markOptimisticPostError,
  markOptimisticPostHeld,
} from "@/lib/optimistic-posts-store";
import { SendToChatsPicker, type SendToChatsOutcome } from "@/components/send-to-chats-picker";
import { parseVideoEmbedUrl } from "@/lib/video-embed";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { useShellText } from "@/components/ui-text";
import { format, plural, byCode } from "@/lib/i18n/locales";
import {
  SHARE_CAPTION_MAX_CHARS,
  STORY_CAPTION_MAX_CHARS,
  chatMessagesForShare,
  combineChatSendOutcomes,
  composerHandOffPath,
  shareTargetOptions,
  type ChatSendOutcome,
  type ShareChannel,
  type ShareCircleRole,
  type UploadedShareMedia,
} from "@/lib/share-target-destinations";

const EMBED_PROVIDER_LABEL: Record<string, string> = {
  YOUTUBE: "YouTube",
  VIMEO: "Vimeo",
  TIKTOK: "TikTok",
  DAILYMOTION: "Dailymotion",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
};

type Conversation = { id: string; label: string; avatarUrl: string | null; username: string | null };
type ShareCircle = {
  id: string;
  name: string;
  slug: string;
  parentName: string | null;
  role: ShareCircleRole;
  channels: ShareChannel[];
};
type View = "root" | "friends" | "circles";
type Status = "idle" | "busy" | "done" | "error";
type UploadOutcome = { ok: true; media: UploadedShareMedia } | { ok: false; error: string };

/**
 * Drops any http(s) link out of shared text before it's used as a public
 * post/story/Muse caption — the whole point of this feature is handing over
 * the actual photo/video Instagram/TikTok/etc. attached, not the bare link
 * those apps' own "Share" action often tacks on alongside it (or, for an
 * app that only ever shares a link with nothing attached, in place of real
 * media). It only seeds the caption box: what the person leaves there is
 * what's posted. Returns "" (not the original text) when nothing but a link
 * remains.
 */
function stripLinks(text: string | null): string {
  if (!text) return "";
  return text
    .replace(/\bhttps?:\/\/\S+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * The inverse of stripLinks() — pulls out just the first http(s) URL from
 * shared text, e.g. "Check this out! https://instagram.com/reel/xyz" → the
 * URL alone. Needed because parseVideoEmbedUrl (video-embed.ts) expects a
 * bare URL, not caption text with one embedded in it — some source apps
 * send exactly that combined string as EXTRA_TEXT.
 */
function extractFirstUrl(text: string | null): string | null {
  if (!text) return null;
  return text.match(/\bhttps?:\/\/\S+/i)?.[0] ?? null;
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

function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Uploads whatever media a share carries through the normal write-once upload path (uploadFileDirect: photos are
 * resized and re-encoded in the browser first, which also drops their EXIF/location data, like every other photo
 * upload). Always the "post-*" kinds whatever the destination: post/message/story share the same size caps (see
 * storage.ts's MEDIA_LIMITS), so one upload is valid for every action below.
 */
async function uploadShare(share: PendingShareMedia): Promise<UploadOutcome> {
  if (share.video) {
    const [videoResult, thumbnailResult, duration] = await Promise.all([
      uploadFileDirect(share.video, "post-video"),
      captureVideoFrameFromFile(share.video).then((frame) => (frame ? uploadFileDirect(frame, "video-thumb") : null)),
      probeVideoDuration(share.video),
    ]);
    if (!videoResult.ok) return { ok: false, error: videoResult.error };
    return {
      ok: true,
      media: {
        mediaType: "VIDEO",
        mediaUrls: [],
        videoUrl: videoResult.publicUrl,
        videoThumbnailUrl: thumbnailResult?.ok ? thumbnailResult.publicUrl : undefined,
        videoDurationSeconds: duration ?? undefined,
      },
    };
  }
  if (share.images.length === 0) return { ok: true, media: { mediaType: "NONE", mediaUrls: [] } };
  const uploaded = await Promise.all(share.images.map((f) => uploadFileDirect(f, "post-image")));
  const failed = uploaded.find((u) => !u.ok);
  if (failed && !failed.ok) return { ok: false, error: failed.error };
  return {
    ok: true,
    media: { mediaType: "IMAGE", mediaUrls: uploaded.map((u) => (u.ok ? u.publicUrl : "")).filter(Boolean) },
  };
}

/**
 * Root-mounted (src/app/layout.tsx) for signed-in members only (never a guest preview session), Android and iOS —
 * the incoming half of the Share-target feature: another app's Share sheet ("Share to YuKon3t", e.g. a screenshot or
 * photos from the gallery) launches or resumes this app, the native side stashes it (Android: MainActivity's
 * handleShareIntent + ShareReceiverPlugin.java; iOS: the Share Extension writes it to the App Group container,
 * ShareReceiverPlugin.swift reads it back) and checkForPendingShare() below reads/consumes it exactly once.
 *
 * Destinations (shareTargetOptions): Story, Muse, Home Feed, a Circle channel the person may post in
 * (getShareTargetCircles; the owner/co-admin also sees private channels), or up to 5 chats (SendToChatsPicker).
 * Picking one uploads the shared media once (cached across destinations) and publishes through the same server
 * actions as everywhere else (createPost / createStory / createMuse / sendToConversations), so every check —
 * verification, membership, channel access, blocks, hidden/secret chats, size/type, moderation and the review hold —
 * applies unchanged. Picking the destination is the confirmation, as tapping "Post" is in the composer; the optional
 * caption box is the only thing edited here.
 *
 * Several photos become one album on Home or in a Circle (createPost makes one Post per photo sharing an albumId), and
 * one message per photo in a chat (chatMessagesForShare). Home posts are optimistic like the composer's: the sheet
 * closes at once and a "Posting…" card shows on Home (optimistic-posts-store.ts) until createPost answers. Circle
 * posts, Story, Muse and chats wait for the answer in the sheet, as their own composers do. createPost's new-device
 * code step needs the composer's code entry: on that answer the share is handed to the composer instead
 * (composerHandOffPath).
 *
 * A share that never carried a photo/video (the source app only sent a link — confirmed live, 2026-09-25: Instagram/
 * TikTok/etc. never attach a file to their own "More"/system-share option for any third-party app) still gets
 * Feed/Circle/Story/Muse whenever that link is a known video-embed provider (parseVideoEmbedUrl): the real player is
 * posted, moderated by the source, the trust boundary createPost's EMBED branch already established. Any other link
 * can only go to a chat.
 */
export function ShareTargetGate({ userId }: { userId: string }) {
  const { t, dir, locale } = useShellText();
  // Not being let into a conversation and being blocked read the same: the send didn't go through.
  const publishError = (code: string) =>
    byCode(t.shareTarget.postErrors, code === "not_a_member" || code === "blocked" ? "send_failed" : code);
  const router = useRouter();
  const [share, setShare] = useState<PendingShareMedia | null>(null);
  const [caption, setCaption] = useState("");
  const [heldNotice, setHeldNotice] = useState(false);
  const [view, setView] = useState<View>("root");
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [circles, setCircles] = useState<ShareCircle[] | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [videoDurationSeconds, setVideoDurationSeconds] = useState<number | null>(null);
  const uploadCacheRef = useRef<UploadedShareMedia | null>(null);

  useEffect(() => {
    const platform = Capacitor.getPlatform();
    if (platform !== "android" && platform !== "ios") return;
    let cancelled = false;
    let listener: { remove: () => void } | undefined;

    function check() {
      checkForPendingShare().then((result) => {
        if (cancelled || !result) return;
        setShare(result);
        setCaption(stripLinks(result.text).slice(0, SHARE_CAPTION_MAX_CHARS));
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
      getMyConversationsForShare()
        .then((r) => setConversations(r.conversations))
        .catch(() => setConversations([]));
    }
  }, [view, conversations]);

  useEffect(() => {
    if (view === "circles" && circles === null) {
      getShareTargetCircles()
        .then((r) => setCircles(r.circles))
        .catch(() => setCircles([]));
    }
  }, [view, circles]);

  const previewUrl = useMemo(() => {
    const first = share?.images[0] ?? share?.video ?? null;
    return first ? URL.createObjectURL(first) : null;
  }, [share]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Needed up front (before anything is uploaded) to decide whether "Add to
  // your story"/"Post to Muse" even show at all — each has its own duration
  // ceiling, probed client-side since a freshly shared file's duration isn't
  // known any other way yet. close() resets it.
  useEffect(() => {
    if (!share?.video) return;
    let cancelled = false;
    probeVideoDuration(share.video).then((d) => {
      if (!cancelled) setVideoDurationSeconds(d);
    });
    return () => {
      cancelled = true;
    };
  }, [share]);

  // Declared up here, ahead of the early return below, because the Escape
  // handler passed to useDialogFocus needs it and hooks can't come after
  // that return.
  function close() {
    setShare(null);
    setCaption("");
    setView("root");
    setConversations(null);
    setCircles(null);
    setStatus("idle");
    setErrorText(null);
    setHeldNotice(false);
    setVideoDurationSeconds(null);
    uploadCacheRef.current = null;
  }

  const dialogRef = useDialogFocus<HTMLDivElement>(share !== null, () => {
    if (status !== "busy") close();
  });

  if (!share) return null;
  const current = share;
  const hasMedia = current.images.length > 0 || Boolean(current.video);
  // Only attempted when there's no real file — share.text alongside real
  // media is usually a caption/link the source app tacked on, not the point.
  const embedUrl = !hasMedia ? extractFirstUrl(current.text) : null;
  const embed = embedUrl ? parseVideoEmbedUrl(embedUrl) : null;
  const options = shareTargetOptions({
    imageCount: current.images.length,
    hasVideo: Boolean(current.video),
    hasEmbed: Boolean(embed),
    videoDurationSeconds,
  });
  const postCaption = caption.trim();

  // Uploads once — bouncing between destinations (open the chat list, go
  // back, pick a Circle instead) must not upload the same file twice.
  async function ensureUploaded(): Promise<UploadOutcome> {
    if (uploadCacheRef.current) return { ok: true, media: uploadCacheRef.current };
    const result = await uploadShare(current);
    if (result.ok) uploadCacheRef.current = result.media;
    return result;
  }

  // createPost's fields for this share, Home or Circle alike. An embed has no
  // upload at all: createPost's EMBED branch re-parses the link server-side.
  function postFormData(media: UploadedShareMedia | null): FormData {
    const fd = new FormData();
    fd.set("content", postCaption);
    if (embed || !media) {
      fd.set("mediaType", "EMBED");
      fd.set("embedUrl", embedUrl!);
    } else {
      fd.set("mediaType", media.mediaType);
      fd.set("mediaUrls", JSON.stringify(media.mediaUrls));
      if (media.mediaType === "VIDEO") {
        fd.set("videoUrl", media.videoUrl);
        if (media.videoThumbnailUrl) fd.set("videoThumbnailUrl", media.videoThumbnailUrl);
        if (media.videoDurationSeconds) fd.set("videoDurationSeconds", String(media.videoDurationSeconds));
      }
    }
    // One key per submission, kept by withRetry's retries: createPost answers a key it already posted with success.
    fd.set("clientRequestId", newRequestId());
    return fd;
  }

  function submitPost(fd: FormData) {
    return withRetry(() => createPost(fd), 3, 1000, false, (err) => !looksLikeStaleServerActionError(err));
  }

  // The composer takes over for the new-device code step, with the caption the person typed (an embed keeps its link).
  function handOffToComposer(target: Parameters<typeof composerHandOffPath>[0]) {
    setPendingShareMedia({ ...current, text: embed ? current.text : postCaption || null });
    close();
    router.push(composerHandOffPath(target));
  }

  // Optimistic, like the composer's Home post: the sheet closes now and the
  // "Posting…" card on Home reports the outcome.
  function publishToFeed() {
    const localId = newRequestId();
    const cached = uploadCacheRef.current;
    const previewFile = current.images[0] ?? current.video ?? null;
    addOptimisticPost({
      localId,
      content: postCaption,
      previewUrl: previewFile ? URL.createObjectURL(previewFile) : null,
      previewKind: current.images[0] ? "image" : current.video ? "video" : "none",
      authorName: t.common.you,
      authorAvatarUrl: null,
      createdAt: new Date(),
      status: "sending",
    });
    close();
    router.push("/home");

    void (async () => {
      let media: UploadedShareMedia | null = null;
      if (!embed) {
        const uploaded = cached ? ({ ok: true, media: cached } as const) : await uploadShare(current);
        if (!uploaded.ok) {
          markOptimisticPostError(localId, byCode(t.shareTarget.uploadErrors, uploaded.error));
          return;
        }
        media = uploaded.media;
      }
      let result;
      try {
        result = await submitPost(postFormData(media));
      } catch (err) {
        markOptimisticPostError(
          localId,
          looksLikeStaleServerActionError(err) ? t.shareTarget.uploadErrors.stale_deployment : publishError("network"),
        );
        return;
      }
      if (result.error === "device_verification_required") {
        removeOptimisticPost(localId);
        setPendingShareMedia({ ...current, text: embed ? current.text : postCaption || null });
        router.push(composerHandOffPath({ kind: "feed", userId }));
        return;
      }
      if (result.error) {
        markOptimisticPostError(localId, publishError(result.error));
        return;
      }
      if ("held" in result && result.held) markOptimisticPostHeld(localId, t.shareTarget.postHeld);
      else removeOptimisticPost(localId);
      router.refresh();
    })();
  }

  async function publishToCircle(circle: ShareCircle, channel: ShareChannel) {
    setStatus("busy");
    setErrorText(null);
    let media: UploadedShareMedia | null = null;
    if (!embed) {
      const uploaded = await ensureUploaded();
      if (!uploaded.ok) {
        setStatus("error");
        setErrorText(byCode(t.shareTarget.uploadErrors, uploaded.error));
        return;
      }
      media = uploaded.media;
    }
    const fd = postFormData(media);
    fd.set("circleId", circle.id);
    fd.set("channelId", channel.id);
    let result;
    try {
      result = await submitPost(fd);
    } catch (err) {
      setStatus("error");
      setErrorText(
        looksLikeStaleServerActionError(err) ? t.shareTarget.uploadErrors.stale_deployment : publishError("network"),
      );
      return;
    }
    if (result.error === "device_verification_required") {
      handOffToComposer({ kind: "circle", circleSlug: circle.slug, channelSlug: channel.slug });
      return;
    }
    if (result.error) {
      setStatus("error");
      setErrorText(publishError(result.error));
      return;
    }
    if ("held" in result && result.held) {
      // Stored but hidden until an admin reviews it: say so, and leave it on screen long enough to read.
      setHeldNotice(true);
      setStatus("done");
      router.refresh();
      setTimeout(close, 6000);
      return;
    }
    setStatus("done");
    router.push(composerHandOffPath({ kind: "circle", circleSlug: circle.slug, channelSlug: channel.slug }));
    router.refresh();
    setTimeout(close, 500);
  }

  // The share to every ticked chat at once. Photos go one message each (a message carries one file), the caption with
  // the first; a share without a file sends its text as is (links kept: a link is normal in a DM). The picker shows
  // the outcome; the gate only stays "busy" meanwhile so the dialog can't be dismissed mid-upload.
  async function sendToFriends(conversationIds: string[]): Promise<SendToChatsOutcome> {
    setStatus("busy");
    setErrorText(null);
    try {
      const uploaded = await ensureUploaded();
      if (!uploaded.ok) {
        return { error: "upload", message: byCode(t.shareTarget.uploadErrors, uploaded.error) };
      }
      const messages = chatMessagesForShare(uploaded.media, hasMedia ? postCaption : (current.text ?? ""));
      const outcomes: ChatSendOutcome[] = [];
      for (const message of messages) {
        const fd = new FormData();
        for (const id of conversationIds) fd.append("conversationIds", id);
        fd.set("content", message.content);
        fd.set("mediaType", message.mediaType);
        if (message.mediaUrl) fd.set("mediaUrl", message.mediaUrl);
        if (message.mediaThumbnailUrl) fd.set("mediaThumbnailUrl", message.mediaThumbnailUrl);
        const result = await sendToConversations(fd);
        if (result.error) {
          // Content-level refusals keep this sheet's own wording; "unavailable"/"rate_limited" are the picker's.
          const own = result.error === "moderation" || result.error === "too_large";
          outcomes.push({ error: result.error, message: own ? publishError(result.error) : undefined });
          break;
        }
        outcomes.push({ sent: result.sent, failed: result.failed });
      }
      return combineChatSendOutcomes(outcomes, conversationIds.length);
    } finally {
      setStatus("idle");
    }
  }

  function afterSentToFriends({ sent, failed, conversationIds }: { sent: number; failed: number; conversationIds: string[] }) {
    if (failed > 0) return;
    // One chat: open it, as sending to a single friend always did. Several: the "Sent to N chats" line, then close.
    if (sent === 1 && conversationIds.length === 1) {
      router.push(`/messages/${conversationIds[0]}`);
      setTimeout(close, 500);
      return;
    }
    setTimeout(close, 1200);
  }

  async function addToStory() {
    setStatus("busy");
    setErrorText(null);
    const fd = new FormData();
    if (embed) {
      fd.set("mediaType", "EMBED");
      fd.set("embedUrl", embedUrl!);
    } else {
      const uploaded = await ensureUploaded();
      if (!uploaded.ok) {
        setStatus("error");
        setErrorText(byCode(t.shareTarget.uploadErrors, uploaded.error));
        return;
      }
      if (uploaded.media.mediaType === "NONE") {
        setStatus("error");
        setErrorText(t.shareTarget.storyNeedsMedia);
        return;
      }
      fd.set("mediaType", uploaded.media.mediaType);
      fd.set("mediaUrl", uploaded.media.mediaType === "VIDEO" ? uploaded.media.videoUrl : uploaded.media.mediaUrls[0]);
      if (uploaded.media.mediaType === "VIDEO" && uploaded.media.videoThumbnailUrl) {
        fd.set("mediaThumbnailUrl", uploaded.media.videoThumbnailUrl);
      }
    }
    // storySchema caps captions at 200 chars: cut rather than fail the whole story with a generic "invalid".
    if (postCaption) fd.set("caption", postCaption.slice(0, STORY_CAPTION_MAX_CHARS));
    const result = await createStory(fd);
    if (result.error) {
      setStatus("error");
      setErrorText(publishError(result.error));
      return;
    }
    if ("held" in result && result.held) {
      // Stored but hidden until an admin reviews it: say so, and leave it on screen long enough to read.
      setHeldNotice(true);
      setStatus("done");
      router.refresh();
      setTimeout(close, 6000);
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
    const fd = new FormData();
    if (embed) {
      fd.set("mediaType", "EMBED");
      fd.set("embedUrl", embedUrl!);
    } else {
      const uploaded = await ensureUploaded();
      if (!uploaded.ok) {
        setStatus("error");
        setErrorText(byCode(t.shareTarget.uploadErrors, uploaded.error));
        return;
      }
      if (uploaded.media.mediaType !== "VIDEO") {
        setStatus("error");
        setErrorText(t.shareTarget.museNeedsVideo);
        return;
      }
      fd.set("videoUrl", uploaded.media.videoUrl);
      if (uploaded.media.videoThumbnailUrl) fd.set("videoThumbnailUrl", uploaded.media.videoThumbnailUrl);
      if (uploaded.media.videoDurationSeconds) fd.set("videoDurationSeconds", String(uploaded.media.videoDurationSeconds));
    }
    if (postCaption) fd.set("caption", postCaption);
    const result = await createMuse(fd);
    if (result.error) {
      setStatus("error");
      setErrorText(publishError(result.error));
      return;
    }
    setStatus("done");
    router.push("/muse");
    router.refresh();
    setTimeout(close, 500);
  }

  const busy = status === "busy";
  // Only truly "link only, nothing this app can do with it" when there's no
  // real media AND the link isn't a recognized embeddable provider either.
  const linkOnly = !hasMedia && !embed && Boolean(current.text);
  const title = view === "root" ? t.shareTarget.title : view === "friends" ? t.shareTarget.sendToFriend : t.shareTarget.chooseCircle;
  const optionClass =
    "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-line/60 disabled:opacity-50";
  const backButton = (
    <button
      type="button"
      onClick={() => setView("root")}
      disabled={busy}
      className="mt-3 text-xs text-foreground-soft hover:text-accent disabled:opacity-50"
    >
      {`${dir === "rtl" ? "→" : "←"} ${t.shareTarget.back}`}
    </button>
  );

  return (
    <div
      ref={dialogRef}
      className="animate-modal-backdrop-in fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto overscroll-contain bg-black/60 p-4 outline-none"
      onClick={busy ? undefined : close}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
    >
      <div
        className="animate-modal-panel-in my-auto w-full max-w-sm rounded-xl bg-surface p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{title}</h2>
          {!busy && (
            <button type="button" onClick={close} aria-label={t.common.close} className="text-foreground-soft hover:text-danger">
              <X size={18} />
            </button>
          )}
        </div>

        {previewUrl &&
          (current.video ? (
            <video src={previewUrl} className="mt-3 max-h-48 w-full rounded-lg bg-black object-contain" controls />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- a transient blob: URL, not a real asset next/image can optimize
            <img src={previewUrl} alt="" className="mt-3 max-h-48 w-full rounded-lg object-contain" />
          ))}
        {!current.video && current.images.length > 1 && (
          <p className="mt-2 text-xs text-foreground-soft">
            {format(t.shareTarget.albumNote, { count: current.images.length })}
          </p>
        )}
        {/* No File object exists for an embed — nothing to build a previewUrl
            from — so this is its own notice instead. */}
        {embed && (
          <p className="mt-3 rounded-lg bg-background px-3 py-2 text-xs text-foreground-soft">
            {EMBED_PROVIDER_LABEL[embed.provider]
              ? format(t.shareTarget.embedDetected, { provider: EMBED_PROVIDER_LABEL[embed.provider] })
              : t.shareTarget.embedDetectedOther}
          </p>
        )}

        {linkOnly && (
          <p className="mt-3 rounded-lg bg-background px-3 py-2 text-xs text-foreground-soft">
            {t.shareTarget.linkOnly}
          </p>
        )}
        {current.skipped > 0 && (
          <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
            {plural(locale, t.shareTarget.skipped, current.skipped)}
          </p>
        )}

        {view === "root" && options.feed && (
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            maxLength={SHARE_CAPTION_MAX_CHARS}
            disabled={busy}
            rows={2}
            dir="auto"
            aria-label={t.shareTarget.caption}
            placeholder={t.shareTarget.caption}
            className="mt-3 w-full resize-none rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-50"
          />
        )}

        {errorText && <p role="alert" className="mt-3 text-xs text-danger">{errorText}</p>}
        {status === "busy" && <p className="mt-3 text-xs text-foreground-soft">{t.shareTarget.posting}</p>}
        {status === "done" &&
          (heldNotice ? (
            <p role="status" className="mt-3 text-xs text-foreground-soft">{t.shareTarget.postHeld}</p>
          ) : (
            <p role="status" className="mt-3 text-xs text-success">{t.shareTarget.posted}</p>
          ))}

        {view === "root" && (
          <div className="mt-3 space-y-1">
            {options.story && (
              <button type="button" onClick={addToStory} disabled={busy} className={optionClass}>
                <CirclePlus size={16} />
                {t.shareTarget.toStory}
              </button>
            )}
            {options.muse && (
              <button type="button" onClick={postToMuse} disabled={busy} className={optionClass}>
                <Clapperboard size={16} />
                {t.shareTarget.toMuse}
              </button>
            )}
            {options.feed && (
              <button type="button" onClick={publishToFeed} disabled={busy} className={optionClass}>
                <SquarePen size={16} />
                {t.shareTarget.toFeed}
              </button>
            )}
            {options.circle && (
              <button type="button" onClick={() => setView("circles")} disabled={busy} className={optionClass}>
                <Users size={16} />
                {t.shareTarget.toCircle}
              </button>
            )}
            <button type="button" onClick={() => setView("friends")} disabled={busy} className={optionClass}>
              <Send size={16} />
              {t.shareTarget.sendToFriend}
            </button>
          </div>
        )}

        {view === "circles" && (
          <>
            {circles === null ? (
              <p className="mt-3 px-2 text-sm text-foreground-soft">{t.common.loading}</p>
            ) : circles.length === 0 ? (
              <p className="mt-3 px-2 text-sm text-foreground-soft">{t.shareTarget.noCircles}</p>
            ) : (
              <ul className="mt-3 max-h-80 space-y-3 overflow-y-auto">
                {circles.map((circle) => (
                  <li key={circle.id}>
                    <div className="flex items-center gap-2 px-2 text-sm font-medium">
                      <span dir="auto" className="min-w-0 flex-1 truncate">
                        {circle.parentName ? `${circle.parentName} › ${circle.name}` : circle.name}
                      </span>
                      {circle.role !== "member" && (
                        <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
                          {circle.role === "owner" ? t.shareTarget.circleOwner : t.shareTarget.circleCoAdmin}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {circle.channels.map((channel) => (
                        <button
                          key={channel.id}
                          type="button"
                          onClick={() => publishToCircle(circle, channel)}
                          disabled={busy || status === "done"}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-sm hover:bg-line/60 disabled:opacity-50"
                        >
                          {channel.isPrivate ? <Lock size={14} aria-hidden /> : <Hash size={14} aria-hidden />}
                          <span dir="auto" className="min-w-0 truncate">{channel.name}</span>
                          {channel.isPrivate && <span className="sr-only">{t.shareTarget.privateChannel}</span>}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {backButton}
          </>
        )}

        {view === "friends" && (
          <>
            <SendToChatsPicker
              items={conversations}
              getKey={(c) => c.id}
              getName={(c) => c.label}
              getUsername={(c) => c.username}
              getAvatarUrl={(c) => c.avatarUrl}
              loading={<li className="px-2 py-1 text-sm text-foreground-soft">{t.common.loading}</li>}
              texts={{ search: t.shareTarget.searchFriends, clear: t.shareTarget.clearSearch, noMatch: t.shareTarget.noFriendMatch, empty: t.shareTarget.noConversations }}
              onSend={sendToFriends}
              onSent={afterSentToFriends}
            />
            {backButton}
          </>
        )}
      </div>
    </div>
  );
}
