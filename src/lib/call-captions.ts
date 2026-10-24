// Live translated captions for 1:1 calls: the pure rules, shared by the browser and the server. Nothing here talks
// to the network or the database.
//
// How it works (see also src/lib/call-captions-server.ts, src/app/actions/call-captions.ts and
// src/lib/use-call-captions.ts):
// - Captions are off by default and opt-in per call, and they are MUTUAL: they run only while BOTH people in the call
//   have agreed (Call.captionsCallerConsentAt / captionsCalleeConsentAt). Either person turning them off clears both
//   agreements, so they have to be asked for again.
// - While they run, each phone transcribes only its OWN microphone (a WebRTC connection straight to OpenAI's realtime
//   transcription; the SDP is exchanged by our server so no OpenAI credential ever reaches the browser) and sends the
//   finished sentences as text to the other phone over the call's own Daily app-message channel.
// - The RECEIVING phone asks our server to translate each sentence into its reader's app language. YuKon3t stores none
//   of it (OpenAI may keep what it processes for a limited time under its own terms; the UI says so):
//   no audio, no transcript, no translation. The database only holds the two agreements, the open transcription
//   sessions (ids and times) and a per-user, per-month count of seconds.
// - Never in a call people were added to (CallParticipant rows exist), never for an ended call.

/** Hard monthly cap per user, in seconds of their own microphone being transcribed. */
export const CALL_CAPTION_MONTHLY_SECONDS = 120 * 60;
/** Captions turn themselves off this long after both people agreed (they can be turned on again). */
export const CALL_CAPTION_MAX_ACTIVE_MS = 60 * 60 * 1000;
/**
 * Each transcription session is paid for in advance, one lease at a time: starting it charges a lease, every
 * heartbeat moves the lease end to now + one lease and charges the difference, and stopping refunds what is left. A
 * session whose lease ran out (the app vanished without stopping it) is hung up by the timeout-missed-calls cron.
 */
export const CALL_CAPTION_LEASE_SECONDS = 90;
/** How often a running session reports in (well inside the lease). */
export const CALL_CAPTION_HEARTBEAT_MS = 45_000;
/** How often the call screen re-reads the caption state while the call is up (app-messages can be missed). */
export const CALL_CAPTION_STATE_POLL_MS = 30_000;
/** Longest sentence sent, translated or shown. */
export const CALL_CAPTION_MAX_CHARS = 500;
/** How long a caption stays on screen after it last changed. */
export const CALL_CAPTION_VISIBLE_MS = 6000;
/** At most this many captions on screen at once (the newest). */
export const CALL_CAPTION_MAX_VISIBLE = 2;
/** Longest SDP offer accepted from a browser. */
export const CALL_CAPTION_MAX_SDP_CHARS = 20_000;

// ---------- Consent ----------

/**
 * What the call screen shows, from this side's point of view:
 * - "off": nobody has asked.
 * - "waiting": I agreed (I asked), the other person hasn't answered yet.
 * - "asked": the other person asked, I haven't answered.
 * - "on": both agreed; captions run.
 */
export type CaptionPhase = "off" | "waiting" | "asked" | "on";

export function captionPhase(consent: { mine: boolean; peer: boolean }): CaptionPhase {
  if (consent.mine && consent.peer) return "on";
  if (consent.mine) return "waiting";
  if (consent.peer) return "asked";
  return "off";
}

/** Which of the two Call columns holds this person's agreement; null if they aren't the call's caller or callee. */
export function consentColumn(
  call: { callerId: string; calleeId: string },
  userId: string,
): "captionsCallerConsentAt" | "captionsCalleeConsentAt" | null {
  if (call.callerId === userId) return "captionsCallerConsentAt";
  if (call.calleeId === userId) return "captionsCalleeConsentAt";
  return null;
}

export type CaptionCallFacts = {
  callerId: string;
  calleeId: string;
  status: string;
  /** How many CallParticipant rows the call has: any at all means people were added (a group call). */
  participantCount: number;
  captionsCallerConsentAt: Date | null;
  captionsCalleeConsentAt: Date | null;
};

export type CaptionIneligibility = "not_found" | "group" | "call_over" | "blocked";

/**
 * Whether captions can exist at all in this call for this person: they must be its caller or callee (answered as
 * not_found otherwise, like every call action), the call must be connected, still 1:1 and nobody blocked either way.
 */
export function captionIneligibility(
  call: CaptionCallFacts | null,
  userId: string,
  blocked: boolean,
): CaptionIneligibility | null {
  if (!call || consentColumn(call, userId) === null) return "not_found";
  if (call.participantCount > 0) return "group";
  if (call.status !== "ACCEPTED") return "call_over";
  if (blocked) return "blocked";
  return null;
}

/** Both agreements, from this person's side. */
export function consentOf(call: CaptionCallFacts, userId: string): { mine: boolean; peer: boolean } {
  const mineIsCaller = call.callerId === userId;
  const caller = call.captionsCallerConsentAt !== null;
  const callee = call.captionsCalleeConsentAt !== null;
  return mineIsCaller ? { mine: caller, peer: callee } : { mine: callee, peer: caller };
}

/** When captions became active (the later of the two agreements), or null while they aren't. */
export function captionsActiveSince(call: Pick<CaptionCallFacts, "captionsCallerConsentAt" | "captionsCalleeConsentAt">) {
  const a = call.captionsCallerConsentAt;
  const b = call.captionsCalleeConsentAt;
  if (!a || !b) return null;
  return a > b ? a : b;
}

/** Whether active captions have reached CALL_CAPTION_MAX_ACTIVE_MS and must turn off. */
export function captionsExpired(activeSince: Date | null, now: Date): boolean {
  return activeSince !== null && now.getTime() - activeSince.getTime() >= CALL_CAPTION_MAX_ACTIVE_MS;
}

// ---------- Monthly minutes ----------

/** The usage row's month key, in UTC ("2026-10"). */
export function captionMonth(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Seconds to charge for moving a lease end from `leaseUntil` to `newLeaseUntil` (never negative). */
export function leaseChargeSeconds(leaseUntil: Date, newLeaseUntil: Date): number {
  return Math.max(0, Math.ceil((newLeaseUntil.getTime() - leaseUntil.getTime()) / 1000));
}

/** Seconds of an unused lease to give back when a session stops at `now`. */
export function leaseRefundSeconds(leaseUntil: Date, now: Date): number {
  return Math.max(0, Math.floor((leaseUntil.getTime() - now.getTime()) / 1000));
}

/** Whether `charge` more seconds still fit under the monthly cap. */
export function fitsMonthlyCap(usedSeconds: number, charge: number, cap = CALL_CAPTION_MONTHLY_SECONDS): boolean {
  return usedSeconds + charge <= cap;
}

/** Minutes left this month (rounded down), for the UI. */
export function minutesLeft(usedSeconds: number, cap = CALL_CAPTION_MONTHLY_SECONDS): number {
  return Math.max(0, Math.floor((cap - usedSeconds) / 60));
}

// ---------- Text ----------

// Control characters (other than tab/newline) and bidirectional overrides/isolates have no place in a caption.
const UNSAFE_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g;

/** A caption as it may be sent, translated or shown: unsafe characters removed, spaces collapsed, length-capped. Empty means nothing to send. */
export function cleanCaptionText(text: unknown): string {
  if (typeof text !== "string") return "";
  return text.replace(UNSAFE_CHARACTERS, "").replace(/\s+/g, " ").trim().slice(0, CALL_CAPTION_MAX_CHARS);
}

/** A plausible SDP offer (the server forwards it to OpenAI as-is; it never logs it). */
export function isPlausibleSdpOffer(sdp: unknown): sdp is string {
  return typeof sdp === "string" && sdp.length > 0 && sdp.length <= CALL_CAPTION_MAX_SDP_CHARS && sdp.startsWith("v=0");
}

// ---------- Messages between the two phones (Daily app-messages) ----------

const CAPTION_MESSAGE_TYPE = "call-caption";
const CAPTION_SIGNAL_TYPE = "call-captions-signal";

/** One finished sentence of the sender's own speech. */
export type CaptionMessage = { id: string; text: string };
/**
 * "changed": the agreements changed, re-read them from the server (the payload is a signal, never the state, which
 * the server alone decides). "cap_reached": the sender's monthly minutes are used up, so their speech isn't captioned.
 */
export type CaptionSignal = "changed" | "cap_reached";

export function captionMessage(id: string, text: string) {
  return { type: CAPTION_MESSAGE_TYPE, id, text };
}

export function captionFromAppMessage(data: unknown): CaptionMessage | null {
  if (!data || typeof data !== "object") return null;
  const msg = data as { type?: unknown; id?: unknown; text?: unknown };
  if (msg.type !== CAPTION_MESSAGE_TYPE) return null;
  if (typeof msg.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(msg.id)) return null;
  const text = cleanCaptionText(msg.text);
  return text ? { id: msg.id, text } : null;
}

export function captionSignal(signal: CaptionSignal) {
  return { type: CAPTION_SIGNAL_TYPE, signal };
}

export function captionSignalFromAppMessage(data: unknown): CaptionSignal | null {
  if (!data || typeof data !== "object") return null;
  const msg = data as { type?: unknown; signal?: unknown };
  if (msg.type !== CAPTION_SIGNAL_TYPE) return null;
  return msg.signal === "changed" || msg.signal === "cap_reached" ? msg.signal : null;
}

// ---------- OpenAI realtime events (data channel "oai-events") ----------

/** The finished transcript of one turn of speech, or null for any other event. */
export function transcriptFromRealtimeEvent(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!event || typeof event !== "object") return null;
  const e = event as { type?: unknown; transcript?: unknown };
  if (e.type !== "conversation.item.input_audio_transcription.completed") return null;
  const text = cleanCaptionText(e.transcript);
  return text || null;
}

/** An error event's code (never its message, which can quote input), or null for any other event. */
export function errorCodeFromRealtimeEvent(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const e = JSON.parse(raw) as { type?: unknown; error?: { code?: unknown; type?: unknown } };
    if (e?.type !== "error") return null;
    const code = e.error?.code ?? e.error?.type;
    return typeof code === "string" ? code.slice(0, 64) : "unknown";
  } catch {
    return null;
  }
}

/** The OpenAI call id from a `Location` header ("/v1/realtime/calls/rtc_abc"), or null. */
export function providerCallIdFromLocation(location: string | null): string | null {
  if (!location) return null;
  const last = location.split("?")[0].split("/").filter(Boolean).pop() ?? "";
  return /^[A-Za-z0-9_-]{4,128}$/.test(last) ? last : null;
}
