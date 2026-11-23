// The chat composer's outbox for recorded voice and video messages (chat-thread.tsx). A recording sends itself the
// moment it stops: no preview, no extra Send. Until the message is stored it is an outbox item, drawn as a bubble of
// its own at the bottom of the thread: "Sending…", or "Not sent" with Retry and Discard. Pure, so the rules run in
// tests without a DOM.
//
// Idempotency: an item's id is its recording's id (RecordingInfo.recordingId), sent as sendMessage's
// clientRequestId. Every attempt for that recording, and any double fire of the same recording, reuses it, and the
// server answers a key it has already stored with that message, so one recording is never sent twice.

/** A recording shorter than this is an accidental tap: discarded, never sent. */
export const MIN_RECORDING_MS = 1000;

export type OutboxKind = "AUDIO" | "VIDEO";
export type OutboxPhase = "uploading" | "sending" | "failed";

/** Why an attempt failed, as shown on the bubble (worded in the thread's errors). */
export type OutboxFailure =
  | "upload"
  | "network"
  | "rate_limited"
  | "blocked"
  | "hidden_locked"
  | "frame_required"
  | "moderation"
  | "too_large"
  | "mode_changed"
  | "other";

export type OutboxUpload = { mediaUrl: string; mediaThumbnailUrl?: string };

export type OutboxItem<F = File> = {
  /** The recording's id; also sendMessage's clientRequestId. */
  id: string;
  conversationId: string;
  kind: OutboxKind;
  file: F;
  durationMs: number;
  replyToMessageId: string | null;
  phase: OutboxPhase;
  /** Kept between attempts only when the file is known to still be there (see keepsUploadAfter). */
  uploaded: OutboxUpload | null;
  failure: OutboxFailure | null;
};

export type OutboxAction<F = File> =
  | { type: "add"; item: OutboxItem<F> }
  | { type: "uploaded"; id: string; uploaded: OutboxUpload }
  | { type: "failed"; id: string; failure: OutboxFailure }
  | { type: "retry"; id: string }
  | { type: "remove"; id: string };

/** Whether a recording of this length is an accidental tap (or a length the recorder couldn't measure). */
export function isAccidentalRecording(durationMs: number): boolean {
  return !(Number.isFinite(durationMs) && durationMs >= MIN_RECORDING_MS);
}

/** A new item for a recording that just stopped: uploading straight away. */
export function newOutboxItem<F>(input: {
  id: string;
  conversationId: string;
  kind: OutboxKind;
  file: F;
  durationMs: number;
  replyToMessageId: string | null;
}): OutboxItem<F> {
  return { ...input, phase: "uploading", uploaded: null, failure: null };
}

/**
 * Whether the file already uploaded can be used again by the next attempt. Only after a send that never got an answer
 * (a network failure): every answer that refuses the send has already deleted its upload on the server
 * (sendMessage's cleanupUploads), so the next attempt uploads again.
 */
export function keepsUploadAfter(failure: OutboxFailure): boolean {
  return failure === "network";
}

/** sendMessage's error code, as the outbox shows it. */
export function outboxFailureFor(error: string): OutboxFailure {
  switch (error) {
    case "rate_limited":
    case "blocked":
    case "hidden_locked":
    case "frame_required":
    case "moderation":
    case "too_large":
      return error;
    case "plaintext_in_secret_chat":
    case "not_a_secret_chat":
    case "not_supported_in_secret_chat":
      return "mode_changed";
    default:
      return "other";
  }
}

export function outboxReducer<F>(items: OutboxItem<F>[], action: OutboxAction<F>): OutboxItem<F>[] {
  switch (action.type) {
    case "add":
      // The same recording reported twice (a double fire) is one item.
      return items.some((i) => i.id === action.item.id) ? items : [...items, action.item];
    case "uploaded":
      return items.map((i) =>
        i.id === action.id && i.phase === "uploading" ? { ...i, phase: "sending", uploaded: action.uploaded } : i,
      );
    case "failed":
      return items.map((i) =>
        i.id === action.id && i.phase !== "failed"
          ? { ...i, phase: "failed", failure: action.failure, uploaded: keepsUploadAfter(action.failure) ? i.uploaded : null }
          : i,
      );
    case "retry":
      // Only a failed item can be retried: a second tap on Retry, or a retry of one already on its way, does nothing.
      return items.map((i) =>
        i.id === action.id && i.phase === "failed"
          ? { ...i, phase: i.uploaded ? "sending" : "uploading", failure: null }
          : i,
      );
    case "remove":
      return items.filter((i) => i.id !== action.id);
  }
}

/** A recording's length as m:ss ("0:07", "2:00"). */
export function formatRecordingClock(durationMs: number): string {
  const total = Math.max(0, Math.round((Number.isFinite(durationMs) ? durationMs : 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
