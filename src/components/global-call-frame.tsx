"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, PhoneOff, ShieldAlert, Upload, X } from "lucide-react";
import { CallFrame } from "@/components/call-frame";
import { LiveVideoFrame } from "@/components/live-video-frame";
import { useCallSession } from "@/lib/call-session";
import { shareCollabMaterial, collabMaterialFromAppMessage, type SharedMaterial } from "@/lib/collab-material";
import { broadcastCaptureAlert, captureAlertFromAppMessage } from "@/lib/capture-alert";
import { onScreenCaptureDetected, type CaptureKind } from "@/lib/screen-capture-guard";

const MATERIAL_ACCEPT = ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,image/jpeg,image/png,image/webp";

type CaptureAlert = { kind: CaptureKind; source: "local" | "remote" };

/** How long a capture alert banner stays up before self-dismissing. */
const CAPTURE_ALERT_DURATION_MS = 6000;

function captureAlertText(alert: CaptureAlert) {
  const captureNoun = alert.kind === "recording" ? "started recording the screen" : "took a screenshot";
  return alert.source === "local"
    ? `You ${captureNoun} — the other participant was notified.`
    : `The other participant ${captureNoun}.`;
}

/**
 * The single place <CallFrame> gets mounted, root-rendered (src/app/layout.tsx)
 * so it survives navigation regardless of which page/component started the
 * session (see call-session.tsx). Toggling `minimized` only changes this
 * wrapper's size/position — the underlying <CallFrame>/Daily iframe never
 * unmounts, so the call itself is never interrupted.
 */
export function GlobalCallFrame() {
  const { session, minimized, dailyCall, setDailyCall, endSession, minimize, expand, reconnectingRef } = useCallSession();
  const [sharedMaterial, setSharedMaterial] = useState<SharedMaterial | null>(null);
  const [uploadingMaterial, setUploadingMaterial] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [captureAlert, setCaptureAlert] = useState<CaptureAlert | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const captureAlertTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A material shared in one session shouldn't bleed into whatever's
  // started next (or reappear if you leave and rejoin the same one). Reset
  // during render (React's supported pattern for this) rather than in an
  // effect, which would cost an extra render pass for the exact same result.
  const prevSessionKeyRef = useRef(session?.key);
  if (prevSessionKeyRef.current !== session?.key) {
    prevSessionKeyRef.current = session?.key;
    setSharedMaterial(null);
    setUploadError(null);
    setCaptureAlert(null);
  }

  function showCaptureAlert(alert: CaptureAlert) {
    setCaptureAlert(alert);
    if (captureAlertTimeoutRef.current) clearTimeout(captureAlertTimeoutRef.current);
    captureAlertTimeoutRef.current = setTimeout(() => setCaptureAlert(null), CAPTURE_ALERT_DURATION_MS);
  }

  // sendAppMessage only reaches *other* participants (see collab-material.ts),
  // so this is how everyone but the uploader sees a shared file appear —
  // the uploader's own copy is set directly in uploadMaterial below. Same
  // channel also carries the other participant's capture alerts.
  useEffect(() => {
    if (!dailyCall) return;
    const handleAppMessage = (ev: { data: unknown }) => {
      const material = collabMaterialFromAppMessage(ev.data);
      if (material) setSharedMaterial(material);
      const captureKind = captureAlertFromAppMessage(ev.data);
      if (captureKind) showCaptureAlert({ kind: captureKind, source: "remote" });
    };
    dailyCall.on("app-message", handleAppMessage);
    return () => {
      dailyCall.off("app-message", handleAppMessage);
    };
  }, [dailyCall]);

  // Native screenshot/screen-recording detection (see
  // src/lib/screen-capture-guard.ts) — watching starts/stops with the call
  // session itself (call-session.tsx), this just reacts to what it reports.
  // Re-subscribes whenever dailyCall changes so the closure below always
  // broadcasts on the current call object (e.g. once it's set right after
  // join, or across a reconnect's leave()+join() pair).
  useEffect(() => {
    if (!session) return;
    return onScreenCaptureDetected((kind) => {
      showCaptureAlert({ kind, source: "local" });
      broadcastCaptureAlert(dailyCall, kind);
    });
  }, [session, dailyCall]);

  async function uploadMaterial(file: File | undefined) {
    if (!file || !session?.collab) return;
    setUploadError(null);
    setUploadingMaterial(true);
    const result = await shareCollabMaterial({ file, conversationId: session.collab.conversationId, dailyCall });
    setUploadingMaterial(false);
    if (!result.ok) {
      setUploadError(
        result.error === "upload_failed" ? "Couldn't upload that file — try again." : "Uploaded, but couldn't share it — try again.",
      );
      return;
    }
    setSharedMaterial(result.material);
  }

  if (!session) return null;

  return (
    <>
      <div
        className={
          minimized
            ? "fixed right-4 z-[60] h-40 w-64 overflow-hidden rounded-xl border border-line bg-black shadow-lg"
            : "fixed inset-0 z-[60] bg-black"
        }
        // bottom offset as an inline style, not a `bottom-*` Tailwind
        // utility — that wasn't taking effect here for reasons that didn't
        // reproduce for any other utility on this same element (right-4/
        // h-40/w-64/z-[60] all applied correctly); this is a guaranteed-to-
        // work fallback. 5rem clears the mobile bottom nav (layout.tsx's
        // `pb-16` on signed-in users) — a bit more clearance than strictly
        // needed on desktop, not worth a resize-aware breakpoint for.
        style={minimized ? { bottom: "5rem" } : undefined}
      >
        {session.renderer === "custom" ? (
          <LiveVideoFrame
            roomUrl={session.roomUrl}
            token={session.token}
            onCallObject={setDailyCall}
            onLeave={() => {
              // Same reconnect-vs-real-hangup distinction as CallFrame below.
              if (reconnectingRef.current) return;
              session.onLeave();
              endSession();
            }}
          />
        ) : (
          <CallFrame
            roomUrl={session.roomUrl}
            token={session.token}
            type={session.type}
            activeSpeakerMode={session.activeSpeakerMode}
            onCallObject={setDailyCall}
            onLeave={() => {
              // A leave() that's the first half of an internal reconnect (see
              // reconnectingRef on CallSessionContext / live-stream-room.tsx's
              // canSend-token-refresh flow) still fires "left-meeting" same as
              // a real hangup — this is what tells the two apart.
              if (reconnectingRef.current) return;
              session.onLeave();
              endSession();
            }}
          />
        )}

        {minimized && (
          // Positioned relative to the small widget itself — a self-
          // contained corner of its own, nothing else renders there, so no
          // stacking-context concerns like the fullscreen button below.
          <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
            <span className="max-w-[7rem] truncate rounded-md bg-black/60 px-2 py-1 text-xs text-white">
              {session.label}
            </span>
            <button
              type="button"
              onClick={expand}
              title="Expand"
              className="rounded-md bg-black/60 p-1.5 text-white hover:bg-black/80"
            >
              <Maximize2 size={14} />
            </button>
            <button
              type="button"
              // Daily's own leave button becomes impractically small at this
              // size — call .leave() directly and let the resulting
              // "left-meeting" event drive CallFrame's onLeave above, same
              // cleanup path as a normal in-app hangup.
              onClick={() => dailyCall?.leave()}
              title="Hang up"
              className="rounded-md bg-danger p-1.5 text-white hover:opacity-90"
            >
              <PhoneOff size={14} />
            </button>
          </div>
        )}

        {!minimized && captureAlert && (
          // Sits above the sharedMaterial panel below (z-[75] > z-[70]) so a
          // capture alert is never hidden behind an open material preview —
          // this is a security-relevant notice, it should always win.
          <div className="pointer-events-none fixed inset-x-4 top-4 z-[75] flex justify-center">
            <div
              role="alert"
              className="pointer-events-auto flex items-center gap-2 rounded-lg border border-danger/40 bg-danger px-3 py-2 text-sm font-medium text-white shadow-lg"
            >
              <ShieldAlert size={16} className="shrink-0" />
              <span>{captureAlertText(captureAlert)}</span>
              <button
                type="button"
                onClick={() => setCaptureAlert(null)}
                title="Dismiss"
                className="shrink-0 rounded-md p-1 hover:bg-white/20"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {!minimized && sharedMaterial && (
          // A floating panel over the call, not inside Daily's own iframe —
          // that's cross-origin, so this is the only place content Daily
          // didn't render itself can actually appear "in" the session. Sits
          // above the video (z-[60] on the wrapper) but below the Leave/
          // Minimize/Upload controls (z-[80]) so those stay reachable.
          <div className="pointer-events-none fixed inset-x-4 top-4 z-[70] flex justify-center">
            <div className="pointer-events-auto flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
              <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
                <span className="min-w-0 truncate text-xs font-medium">{sharedMaterial.name}</span>
                <button
                  type="button"
                  onClick={() => setSharedMaterial(null)}
                  title="Close"
                  className="shrink-0 rounded-md p-1 text-foreground-soft hover:bg-background"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto bg-background">
                {sharedMaterial.contentType.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={sharedMaterial.url} alt={sharedMaterial.name} className="mx-auto max-h-[65vh] object-contain" />
                ) : sharedMaterial.contentType === "application/pdf" ? (
                  <iframe src={sharedMaterial.url} title={sharedMaterial.name} className="h-[65vh] w-full" />
                ) : (
                  <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-foreground-soft">
                    <span>Preview isn&apos;t available for this file type.</span>
                    <a
                      href={sharedMaterial.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent"
                    >
                      Open {sharedMaterial.name}
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {!minimized && (
        // Rendered as a SIBLING of the z-[60] video wrapper above, not a
        // descendant — `position: fixed` + `z-index` establishes a new
        // stacking context, so a high z-index on a *descendant* can never
        // out-rank a sibling of its ancestor (e.g. LiveStreamRoom's
        // top-corner Record/Screenshot/viewer-count bars, z-[70]) no matter
        // how large that descendant's own z-index is. This has to sit at
        // the same level as that div to actually win. Bottom-right since
        // every corner near the top is already spoken for between those
        // and Daily's own built-in controls.
        <div className="fixed bottom-4 right-4 z-[80] flex items-center gap-1.5">
          {uploadError && (
            <span className="max-w-[10rem] truncate rounded-md bg-danger/90 px-2 py-1 text-xs text-white">
              {uploadError}
            </span>
          )}
          {session.collab && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept={MATERIAL_ACCEPT}
                className="hidden"
                onChange={(e) => uploadMaterial(e.target.files?.[0])}
              />
              <button
                type="button"
                disabled={uploadingMaterial}
                // The pre-join card's own "Upload material" button (see
                // collab-session-room.tsx) sits behind this fullscreen
                // wrapper once a session is joined — this is the only
                // reachable trigger for it once you're actually in the call.
                onClick={() => fileInputRef.current?.click()}
                title="Upload material to share with participants"
                className="rounded-md bg-black/60 p-1.5 text-white hover:bg-black/80 disabled:opacity-50"
              >
                <Upload size={14} />
              </button>
            </>
          )}
          <button
            type="button"
            // App-level leave control alongside Minimize, not just Daily's
            // own in-iframe leave button — same .leave() call as the
            // minimized widget's hang-up button below, kept reachable even
            // fullscreen so leaving never depends on finding Daily's own
            // control inside the call UI (e.g. tucked under its "..." menu
            // on a narrow viewport).
            onClick={() => dailyCall?.leave()}
            title="Leave session"
            className="rounded-md bg-danger p-1.5 text-white hover:opacity-90"
          >
            <PhoneOff size={14} />
          </button>
          <button
            type="button"
            onClick={minimize}
            title="Minimize"
            className="rounded-md bg-black/60 p-1.5 text-white hover:bg-black/80"
          >
            <Minimize2 size={14} />
          </button>
        </div>
      )}
    </>
  );
}
