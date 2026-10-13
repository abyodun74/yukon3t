"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, X } from "lucide-react";
import { getViewOnceContentType, openViewOnceMessage, finishViewOnceMessage } from "@/app/actions/view-once";
import { pauseAllPlayingVideos, resumePausedVideos } from "@/lib/video-playback-guard";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { viewOnceCanPlay, type ViewOnceMediaType } from "@/lib/view-once";
import { useMessagesText } from "@/components/ui-text";
import type { messagesEn } from "@/lib/i18n/en";

type Phase =
  | { step: "confirm" }
  | { step: "loading" }
  | { step: "showing"; objectUrl: string; mediaType: ViewOnceMediaType }
  // `retry`: the download failed but the server may still re-issue a link (the retry window after the first open).
  | { step: "failed"; message: string; retry: boolean };

const DOWNLOAD_ATTEMPTS = 3;

function failureFor(
  code: string,
  failures: typeof messagesEn.thread.viewOnce.failures,
): { message: string; retry: boolean } {
  switch (code) {
    case "already_viewed":
    case "expired":
      return { message: failures[code], retry: false };
    case "unavailable":
    case "download":
      return { message: failures[code], retry: true };
    default:
      return { message: failures.gone, retry: false };
  }
}

/**
 * Shows a view-once photo or video to its recipient, once. After the confirm step it first asks what type the file
 * is and stops — without using the view — if it is a video this device can't play. Then it claims the open on the
 * server, downloads the file into memory through a 60-second link and displays it from a blob: URL that is revoked
 * the moment this closes. The server is told to delete the stored file once the media has actually rendered, or when
 * this closes or the media fails after a claim; if that call never gets through, the server's own sweep deletes it
 * a few minutes later. Nothing here offers save, share or download. It cannot stop a screenshot, a screen recording
 * or another camera.
 */
export function ViewOnceViewer({
  messageId,
  mediaType,
  onOpened,
  onClose,
}: {
  messageId: string;
  mediaType: ViewOnceMediaType;
  /** The open was claimed on the server: the bubble should read "Opened" from now on, whatever happens next. */
  onOpened: () => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ step: "confirm" });
  const t = useMessagesText().t.thread.viewOnce;
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onClose);
  const objectUrlRef = useRef<string | null>(null);
  const aliveRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  // The open was claimed on the server / the server has been told to delete the file.
  const claimedRef = useRef(false);
  const finishedRef = useRef(false);
  const onOpenedRef = useRef(onOpened);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onOpenedRef.current = onOpened;
    onCloseRef.current = onClose;
  });

  const finish = useCallback(() => {
    if (!claimedRef.current || finishedRef.current) return;
    finishedRef.current = true;
    void finishViewOnceMessage(messageId).catch(() => {});
  }, [messageId]);

  useEffect(() => {
    aliveRef.current = true;
    pauseAllPlayingVideos();
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
      // Closed after a claim (shown or not): the stored file has no further use.
      finish();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      resumePausedVideos();
    };
  }, [finish]);

  // Leaving the app (switching apps, locking the phone) while the media is on screen ends the view — it must not
  // still be there in the app switcher or when someone else picks the phone up. Not while it is still downloading:
  // closing then would waste the one view on something never shown.
  const showing = phase.step === "showing";
  useEffect(() => {
    if (!showing) return;
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") onCloseRef.current();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [showing]);

  const load = useCallback(async () => {
    setPhase({ step: "loading" });
    // Before the one view is used: is this something the device can show at all? Skipped once claimed (a retry).
    if (!claimedRef.current) {
      let kind;
      try {
        kind = await getViewOnceContentType(messageId);
      } catch {
        kind = null;
      }
      if (!aliveRef.current) return;
      if (!kind) {
        setPhase({ step: "failed", message: t.failures.precheck, retry: true });
        return;
      }
      if (kind.error !== null) {
        setPhase({ step: "failed", ...failureFor(kind.error, t.failures) });
        return;
      }
      if (
        kind.contentType &&
        !viewOnceCanPlay(kind.contentType, (type) => document.createElement("video").canPlayType(type))
      ) {
        setPhase({ step: "failed", message: t.failures.unplayable, retry: false });
        return;
      }
    }
    let failure = "download";
    for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
      if (!aliveRef.current) return;
      let opened;
      try {
        // The first call claims the open; a repeat inside the retry window gets a fresh link to the same file.
        opened = await openViewOnceMessage(messageId);
      } catch {
        opened = null;
      }
      if (!aliveRef.current) return;
      if (opened && opened.error !== null) {
        failure = opened.error;
        if (opened.error !== "unavailable") break;
      } else if (opened) {
        claimedRef.current = true;
        onOpenedRef.current();
        try {
          const controller = new AbortController();
          abortRef.current = controller;
          const res = await fetch(opened.url, { cache: "no-store", credentials: "omit", signal: controller.signal });
          if (!res.ok) throw new Error(`download_${res.status}`);
          const bytes = await res.arrayBuffer();
          if (!aliveRef.current) return;
          // The stored copy is deleted (finish) once the element below has rendered it, not here.
          const objectUrl = URL.createObjectURL(new Blob([bytes], { type: opened.contentType }));
          objectUrlRef.current = objectUrl;
          setPhase({ step: "showing", objectUrl, mediaType: opened.mediaType === "VIDEO" ? "VIDEO" : "IMAGE" });
          return;
        } catch {
          if (!aliveRef.current) return;
          failure = "download";
        }
      }
      if (attempt < DOWNLOAD_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
    if (aliveRef.current) setPhase({ step: "failed", ...failureFor(failure, t.failures) });
  }, [messageId, t]);

  // The bytes arrived but the element can't show them. Nothing more this device can do with the file.
  const onMediaError = () => {
    finish();
    setPhase({
      step: "failed",
      message: t.failures.cantShow[mediaType],
      retry: false,
    });
  };
  const blockSave = (e: { preventDefault: () => void }) => e.preventDefault();

  return (
    <div
      ref={dialogRef}
      role="dialog"
      // Also what keeps nav.tsx's swipe-between-tabs listener off any gesture made in here.
      aria-modal="true"
      aria-label={t.label[mediaType]}
      tabIndex={-1}
      onContextMenu={blockSave}
      // ph-no-capture: private media, kept out of session replay like every message bubble.
      className="ph-no-capture animate-modal-backdrop-in fixed inset-0 z-50 flex select-none items-center justify-center bg-black p-4 outline-none"
      style={{ WebkitTouchCallout: "none" }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t.close}
        className="absolute end-4 top-[calc(1rem+max(env(safe-area-inset-top),var(--status-bar-inset-top,0px)))] z-10 rounded-full bg-black/40 p-2 text-white/80 hover:text-white"
      >
        <X size={24} aria-hidden />
      </button>

      {phase.step === "confirm" && (
        <div className="w-full max-w-sm rounded-2xl bg-surface p-5 text-center text-foreground">
          <Eye size={28} aria-hidden className="mx-auto text-accent" />
          <h2 className="mt-3 text-base font-semibold">{t.confirmTitle}</h2>
          <p className="mt-2 text-sm text-foreground-soft">
            {t.confirmBody[mediaType]}
          </p>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-line px-3 py-2 text-sm font-medium hover:bg-line"
            >
              {t.notNow}
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="flex-1 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink"
            >
              {t.view[mediaType]}
            </button>
          </div>
        </div>
      )}

      {phase.step === "loading" && (
        <p role="status" className="text-sm text-white/80">
          {t.loading}
        </p>
      )}

      {phase.step === "failed" && (
        <div className="w-full max-w-sm rounded-2xl bg-surface p-5 text-center text-foreground">
          <p role="alert" className="text-sm">
            {phase.message}
          </p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-line px-3 py-2 text-sm font-medium hover:bg-line"
            >
              {t.close}
            </button>
            {phase.retry && (
              <button
                type="button"
                onClick={() => void load()}
                className="flex-1 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink"
              >
                {t.tryAgain}
              </button>
            )}
          </div>
        </div>
      )}

      {phase.step === "showing" && phase.mediaType === "IMAGE" && (
        // eslint-disable-next-line @next/next/no-img-element -- in-memory blob: URL, not an optimizable remote image
        <img
          src={phase.objectUrl}
          alt={t.label[phase.mediaType]}
          draggable={false}
          onLoad={finish}
          onError={onMediaError}
          onContextMenu={blockSave}
          onDragStart={blockSave}
          className="pointer-events-none max-h-full max-w-full object-contain"
          style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
        />
      )}
      {phase.step === "showing" && phase.mediaType === "VIDEO" && (
        <video
          src={phase.objectUrl}
          controls
          controlsList="nodownload noremoteplayback"
          disablePictureInPicture
          disableRemotePlayback
          playsInline
          autoPlay
          draggable={false}
          onLoadedData={finish}
          onError={onMediaError}
          onContextMenu={blockSave}
          aria-label={t.label[phase.mediaType]}
          className="max-h-full max-w-full bg-black"
          style={{ WebkitTouchCallout: "none" }}
        />
      )}
    </div>
  );
}
