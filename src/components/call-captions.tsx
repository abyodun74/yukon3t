"use client";

import { useId, useState } from "react";
import { Captions, CaptionsOff } from "lucide-react";
import { useCallsText } from "@/components/calls-text";
import { peerNotice, type CallPeer } from "@/lib/call-names";
import { captionDisplayText } from "@/lib/call-caption-queue";
import type { CallCaptions } from "@/lib/use-call-captions";

// Live translated captions on the 1:1 call screen (logic: src/lib/use-call-captions.ts). The button sits in the
// control tray; the layer holds the "on" indicator, the agreement dialogs, short notices and the captions themselves
// (bottom, above the tray, never over the controls). DirectCallFrame doesn't render the layer while minimized.

/** The tray button: turn on (opens the notice first), or turn off. Hidden when captions can't exist in this call. */
export function CallCaptionsButton({
  captions,
  onRequestOn,
  disabled,
}: {
  captions: CallCaptions;
  onRequestOn: () => void;
  disabled?: boolean;
}) {
  const { t: calls } = useCallsText();
  const t = calls.captions;
  if (!captions.state?.available) return null;
  const { phase } = captions;
  const engaged = phase === "on" || phase === "waiting";
  const label = phase === "on" ? t.turnOff : phase === "waiting" ? t.waitingShort : t.turnOn;
  return (
    <button
      type="button"
      onClick={() => (engaged ? captions.turnOff() : onRequestOn())}
      disabled={disabled || captions.busy}
      title={label}
      aria-label={label}
      aria-pressed={engaged}
      className={`flex h-10 w-10 items-center justify-center rounded-full text-white transition-transform active:scale-90 disabled:opacity-50 ${engaged ? "bg-accent text-accent-ink" : "bg-white/20"}`}
    >
      {engaged ? <CaptionsOff size={16} /> : <Captions size={16} />}
    </button>
  );
}

function CaptionDialog({
  title,
  body,
  primary,
  secondary,
  onPrimary,
  onSecondary,
  busy,
}: {
  title: string;
  body: string[];
  primary: string;
  secondary: string;
  onPrimary: () => void;
  onSecondary: () => void;
  busy: boolean;
}) {
  const titleId = useId();
  const { dir } = useCallsText();
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        dir={dir}
        className="hig-material-dark w-full max-w-sm rounded-2xl bg-black/80 p-4 text-white shadow-lg backdrop-blur-md"
      >
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        {body.map((p) => (
          <p key={p} className="mt-2 text-sm text-white/80">
            {p}
          </p>
        ))}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onSecondary}
            className="rounded-full px-4 py-2 text-sm text-white/80 transition-transform hover:bg-white/10 active:scale-95"
          >
            {secondary}
          </button>
          <button
            type="button"
            onClick={onPrimary}
            disabled={busy}
            className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-transform active:scale-95 disabled:opacity-50"
          >
            {primary}
          </button>
        </div>
      </div>
    </div>
  );
}

export function CallCaptionsLayer({
  captions,
  peer,
  confirming,
  onCloseConfirm,
}: {
  captions: CallCaptions;
  peer: CallPeer;
  /** This side tapped the button and is reading the notice before agreeing. */
  confirming: boolean;
  onCloseConfirm: () => void;
}) {
  const { t: calls, dir } = useCallsText();
  const t = calls.captions;
  const [showOriginal, setShowOriginal] = useState(false);
  if (!captions.state?.available && !captions.notice) return null;
  const { phase } = captions;
  // The other person is "Private call" for a hidden chat: never named, here or anywhere else on this screen.
  const forms = (named: string, other: string, priv: string) => peerNotice(peer, { named, other, everyone: other, private: priv });
  const anyTranslated = captions.captions.some((c) => c.translation.status === "translated");
  const status =
    phase === "on" ? t.on : phase === "waiting" ? forms(t.waiting, t.waitingOther, t.waitingPrivate) : null;

  return (
    <>
      {status && (
        <div className="pointer-events-none absolute inset-x-0 top-[calc(1rem+max(env(safe-area-inset-top),var(--status-bar-inset-top,0px)))] z-10 flex justify-center px-28">
          <span
            role="status"
            dir={dir}
            className="hig-material-dark flex max-w-full items-center gap-1.5 truncate rounded-full bg-black/60 px-3 py-1.5 text-xs text-white backdrop-blur-md"
          >
            <Captions size={12} className="shrink-0" aria-hidden />
            <span className="truncate">{status}</span>
          </span>
        </div>
      )}

      {confirming && phase !== "on" && (
        <CaptionDialog
          title={t.noticeTitle}
          body={[t.notice, forms(t.noticeMutual, t.noticeMutualOther, t.noticeMutualPrivate)]}
          primary={t.confirm}
          secondary={t.cancel}
          busy={captions.busy}
          onPrimary={() => {
            captions.agree();
            onCloseConfirm();
          }}
          onSecondary={onCloseConfirm}
        />
      )}

      {!confirming && phase === "asked" && (
        <CaptionDialog
          title={forms(t.askTitle, t.askTitleOther, t.askTitlePrivate)}
          body={[t.notice]}
          primary={t.allow}
          secondary={t.notNow}
          busy={captions.busy}
          onPrimary={captions.agree}
          onSecondary={captions.turnOff}
        />
      )}

      {/* Above the control tray (and the Leave/Minimize bar below sm), never over either. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[calc(8.5rem+max(env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px)))] z-10 flex flex-col items-center gap-1 px-4 sm:bottom-[calc(5rem+max(env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px)))]">
        {captions.notice && (
          <span
            role="status"
            dir={dir}
            className="hig-material-dark max-w-xl rounded-lg bg-black/70 px-3 py-1.5 text-center text-xs text-white backdrop-blur-md"
          >
            {t.notices[captions.notice]}
          </span>
        )}
        <div
          role="log"
          aria-live="polite"
          aria-label={t.region}
          className="ph-no-capture flex w-full max-w-xl flex-col items-center gap-1"
        >
          {captions.captions.map((c) => (
            <p
              key={c.id}
              dir="auto"
              className={`line-clamp-2 rounded-lg bg-black/70 px-3 py-1 text-center text-base leading-snug text-white backdrop-blur-md ${c.translation.status === "pending" ? "opacity-70" : ""}`}
            >
              {captionDisplayText(c, showOriginal)}
            </p>
          ))}
        </div>
        {anyTranslated && (
          <button
            type="button"
            onClick={() => setShowOriginal((v) => !v)}
            className="pointer-events-auto rounded-full bg-black/60 px-3 py-1 text-xs text-white/90 backdrop-blur-md transition-transform active:scale-95"
          >
            {showOriginal ? t.showTranslation : t.showOriginal}
          </button>
        )}
      </div>
    </>
  );
}
