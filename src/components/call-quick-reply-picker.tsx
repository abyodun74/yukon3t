"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Send } from "lucide-react";
import type { callsEn } from "@/lib/i18n/en/calls";
import {
  CALL_QUICK_REPLY_CUSTOM_MAX,
  CALL_QUICK_REPLY_PRESET_IDS,
  sanitizeCallReplyText,
  type CallQuickReplyChoice,
} from "@/lib/call-quick-reply";

/**
 * The incoming-call card's "Message" panel: the preset quick replies and one short reply of the person's own. Picking
 * one declines the call and sends it (IncomingCallListener). Focus lands on the first reply when it opens; Escape and
 * Back return to the Accept/Decline buttons.
 */
export function CallQuickReplyPicker({
  text,
  onPick,
  onBack,
}: {
  text: (typeof callsEn)["quickReply"];
  onPick: (choice: CallQuickReplyChoice) => void;
  onBack: () => void;
}) {
  const [custom, setCustom] = useState("");
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstRef.current?.focus({ preventScroll: true });
  }, []);

  const cleaned = sanitizeCallReplyText(custom);
  const canSendCustom = cleaned.length > 0 && cleaned.length <= CALL_QUICK_REPLY_CUSTOM_MAX;

  return (
    <div
      role="group"
      aria-label={text.title}
      className="mt-3 w-[min(20rem,calc(100vw-4rem))]"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onBack();
        }
      }}
    >
      <div className="mb-2 flex items-center gap-1">
        <button
          type="button"
          onClick={onBack}
          aria-label={text.back}
          className="-ms-2 flex min-h-11 min-w-11 items-center justify-center rounded-lg text-foreground-soft hover:text-foreground"
        >
          <ChevronLeft size={18} className="rtl:rotate-180" aria-hidden />
        </button>
        <p className="text-sm font-medium">{text.title}</p>
      </div>
      <ul className="max-h-[40vh] space-y-1 overflow-y-auto overscroll-contain">
        {CALL_QUICK_REPLY_PRESET_IDS.map((id, i) => (
          <li key={id}>
            <button
              ref={i === 0 ? firstRef : undefined}
              type="button"
              onClick={() => onPick({ kind: "preset", presetId: id })}
              className="min-h-11 w-full rounded-lg border border-line px-3 py-2 text-start text-sm hover:border-accent hover:text-accent"
            >
              {text.presets[id]}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSendCustom) onPick({ kind: "custom", text: cleaned });
        }}
      >
        <input
          type="text"
          dir="auto"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          maxLength={CALL_QUICK_REPLY_CUSTOM_MAX}
          aria-label={text.customLabel}
          placeholder={text.customPlaceholder}
          enterKeyHint="send"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm"
        />
        <button
          type="submit"
          disabled={!canSendCustom}
          aria-label={text.sendLabel}
          title={text.send}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-accent text-accent-ink disabled:opacity-40"
        >
          <Send size={16} className="rtl:-scale-x-100" aria-hidden />
        </button>
      </form>
    </div>
  );
}
