import { prisma } from "@/lib/prisma";
import { captureError } from "@/lib/error-tracking";
import { isBlockedEitherWay } from "@/lib/blocks";
import {
  CALL_CAPTION_MONTHLY_SECONDS,
  captionIneligibility,
  captionMonth,
  leaseRefundSeconds,
  providerCallIdFromLocation,
  type CaptionCallFacts,
  type CaptionIneligibility,
} from "@/lib/call-captions";

// The server half of live translated captions in 1:1 calls (rules: src/lib/call-captions.ts). The provider is OpenAI,
// on the existing OPENAI_API_KEY: realtime transcription (CALL_CAPTIONS_STT_MODEL, default gpt-4o-mini-transcribe)
// for each person's own microphone, and the translation model already used for posts (TRANSLATION_MODEL) for each
// received sentence. Off unless CALL_CAPTIONS_ENABLED=1 and OPENAI_API_KEY are both set.
//
// No OpenAI credential reaches the browser, not even an ephemeral one: the browser hands us its WebRTC SDP offer, we
// mint a short-lived client secret for a transcription-only session and exchange the SDP with it ourselves, and the
// browser gets back only the SDP answer. Its audio then goes straight to OpenAI over WebRTC (never through us). Doing
// the exchange here also gives us OpenAI's call id (the Location header), which is what lets us hang a session up
// when consent is withdrawn, the call ends, the lease runs out or the monthly cap is hit.
//
// Nothing here receives, stores or logs audio or transcript text.

const DEFAULT_CAPTION_STT_MODEL = "gpt-4o-mini-transcribe";
const OPENAI_TIMEOUT_MS = 10_000;
/** How long the minted client secret can be used to start the session (it is used at once, by us). */
const CLIENT_SECRET_TTL_SECONDS = 60;

export function isCallCaptionsConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY) && process.env.CALL_CAPTIONS_ENABLED === "1";
}

function captionSttModel(): string {
  return process.env.CALL_CAPTIONS_STT_MODEL?.trim() || DEFAULT_CAPTION_STT_MODEL;
}

/**
 * The transcription-only session every caption connection gets. Server VAD means only speech is committed and
 * transcribed (silence produces nothing); near-field noise reduction suits a phone held close. No language is set:
 * people often speak something other than their app language, so the model detects it.
 */
function captionSessionConfig(model = captionSttModel()) {
  return {
    type: "transcription",
    audio: {
      input: {
        noise_reduction: { type: "near_field" },
        transcription: { model },
        turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 600 },
      },
    },
  } as const;
}

// One report per 10 minutes per server instance per reason; never with any user content (there is none here).
const lastReportAt = new Map<string, number>();
function reportCaptionFailure(reason: string, error?: unknown) {
  const now = Date.now();
  if (now - (lastReportAt.get(reason) ?? 0) < 10 * 60_000) return;
  lastReportAt.set(reason, now);
  console.error(`[call-captions] ${reason}`);
  void captureError(error ?? new Error(`Call captions: ${reason}`), { where: "call-captions", reason });
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Starts one transcription session at OpenAI for the browser's SDP offer: a client secret for a transcription-only
 * session (60s to use), then the WebRTC call created with it. Null on any failure.
 */
export async function openCaptionTranscription(
  sdpOffer: string,
): Promise<{ sdpAnswer: string; providerCallId: string | null } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const secretRes = await fetchWithTimeout("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: CLIENT_SECRET_TTL_SECONDS },
        session: captionSessionConfig(),
      }),
    });
    if (!secretRes.ok) {
      reportCaptionFailure(`client secret HTTP ${secretRes.status}`);
      return null;
    }
    const secret = (await secretRes.json()) as { value?: unknown };
    if (typeof secret?.value !== "string" || !secret.value) {
      reportCaptionFailure("client secret missing");
      return null;
    }
    const callRes = await fetchWithTimeout("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret.value}`, "Content-Type": "application/sdp" },
      body: sdpOffer,
    });
    if (!callRes.ok) {
      reportCaptionFailure(`call create HTTP ${callRes.status}`);
      return null;
    }
    const sdpAnswer = await callRes.text();
    if (!sdpAnswer.startsWith("v=0")) {
      reportCaptionFailure("call create: no SDP answer");
      return null;
    }
    const providerCallId = providerCallIdFromLocation(callRes.headers.get("location"));
    if (!providerCallId) reportCaptionFailure("call create: no call id (session can't be hung up server-side)");
    return { sdpAnswer, providerCallId };
  } catch (err) {
    reportCaptionFailure("openai unreachable", err);
    return null;
  }
}

/** Ends a session at OpenAI. Best-effort: the browser closes its side too, and OpenAI ends idle sessions itself. */
async function hangUpProviderCall(providerCallId: string | null): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !providerCallId) return;
  try {
    const res = await fetchWithTimeout(
      `https://api.openai.com/v1/realtime/calls/${encodeURIComponent(providerCallId)}/hangup`,
      { method: "POST", headers: { Authorization: `Bearer ${apiKey}` } },
    );
    // 404: already over (the browser closed it first). Anything else is worth knowing about.
    if (!res.ok && res.status !== 404) reportCaptionFailure(`hangup HTTP ${res.status}`);
  } catch (err) {
    reportCaptionFailure("hangup failed", err);
  }
}

// ---------- The call ----------

async function loadCaptionCall(callId: string): Promise<CaptionCallFacts | null> {
  const call = await prisma.call.findUnique({
    where: { id: callId },
    select: {
      callerId: true,
      calleeId: true,
      status: true,
      captionsCallerConsentAt: true,
      captionsCalleeConsentAt: true,
      _count: { select: { participants: true } },
    },
  });
  if (!call) return null;
  const { _count, ...rest } = call;
  return { ...rest, participantCount: _count.participants };
}

/** The call and why captions can't exist in it for this person (null = they can). */
export async function loadCaptionContext(
  userId: string,
  callId: string,
): Promise<{ call: CaptionCallFacts | null; ineligible: CaptionIneligibility | null }> {
  const call = await loadCaptionCall(callId);
  if (!call || (call.callerId !== userId && call.calleeId !== userId)) return { call: null, ineligible: "not_found" };
  const peerId = call.callerId === userId ? call.calleeId : call.callerId;
  const blocked = await isBlockedEitherWay(userId, peerId);
  return { call, ineligible: captionIneligibility(call, userId, blocked) };
}

/** Clears both agreements: captions are off for both people until asked for again. */
export async function clearCaptionConsents(callId: string): Promise<void> {
  await prisma.call.updateMany({
    where: { id: callId },
    data: { captionsCallerConsentAt: null, captionsCalleeConsentAt: null },
  });
}

// ---------- Monthly seconds ----------

export async function usedCaptionSeconds(userId: string, now = new Date()): Promise<number> {
  const row = await prisma.callCaptionUsage.findUnique({
    where: { userId_month: { userId, month: captionMonth(now) } },
    select: { seconds: true },
  });
  return row?.seconds ?? 0;
}

/**
 * Charges `seconds` to this month's count, only if it still fits under the cap (one guarded UPDATE, so two sessions
 * or two heartbeats at once can't both squeeze past it). False = cap reached, nothing charged.
 */
export async function chargeCaptionSeconds(userId: string, seconds: number, now = new Date()): Promise<boolean> {
  if (seconds <= 0) return true;
  const month = captionMonth(now);
  await prisma.callCaptionUsage.createMany({ data: [{ userId, month, seconds: 0 }], skipDuplicates: true });
  const { count } = await prisma.callCaptionUsage.updateMany({
    where: { userId, month, seconds: { lte: CALL_CAPTION_MONTHLY_SECONDS - seconds } },
    data: { seconds: { increment: seconds } },
  });
  return count > 0;
}

/** Gives back unused paid seconds (never below zero; nothing if the month has turned since). */
async function refundCaptionSeconds(userId: string, seconds: number, chargedAt: Date, now = new Date()) {
  if (seconds <= 0 || captionMonth(chargedAt) !== captionMonth(now)) return;
  await prisma.callCaptionUsage.updateMany({
    where: { userId, month: captionMonth(now), seconds: { gte: seconds } },
    data: { seconds: { decrement: seconds } },
  });
}

// ---------- Sessions ----------

type OpenSession = { id: string; userId: string; providerCallId: string | null; leaseUntil: Date };

/**
 * Ends these sessions: each is claimed once (guarded on endedAt still null, so a racing stop, heartbeat or cron does
 * the rest only once), its unused lease is refunded when `refund` is set, and it is hung up at OpenAI.
 */
async function endSessions(sessions: OpenSession[], refund: boolean): Promise<number> {
  const now = new Date();
  let ended = 0;
  await Promise.all(
    sessions.map(async (s) => {
      const { count } = await prisma.callCaptionSession.updateMany({
        where: { id: s.id, endedAt: null },
        data: { endedAt: now },
      });
      if (count === 0) return;
      ended += 1;
      if (refund) {
        // The lease was charged in the month its last extension happened; the refund only applies within it.
        await refundCaptionSeconds(s.userId, leaseRefundSeconds(s.leaseUntil, now), now, now).catch((err) =>
          reportCaptionFailure("refund failed", err),
        );
      }
      await hangUpProviderCall(s.providerCallId);
    }),
  );
  return ended;
}

const OPEN_SESSION_SELECT = { id: true, userId: true, providerCallId: true, leaseUntil: true } as const;

/** Ends one person's open session(s) in a call (a stop, or a restart replacing the old one). */
export async function endUserCaptionSessions(userId: string, callId: string, onlySessionId?: string) {
  const sessions = await prisma.callCaptionSession.findMany({
    where: { userId, callId, endedAt: null, ...(onlySessionId ? { id: onlySessionId } : {}) },
    select: OPEN_SESSION_SELECT,
  });
  return endSessions(sessions, true);
}

/** Ends everyone's open sessions in a call: captions turned off, the call ended, or people were added to it. */
export async function endCaptionSessionsForCall(callId: string): Promise<number> {
  const sessions = await prisma.callCaptionSession.findMany({
    where: { callId, endedAt: null },
    select: OPEN_SESSION_SELECT,
  });
  return endSessions(sessions, true);
}

/**
 * Best-effort from call code (endCall, inviteToCall): turns captions off and hangs every session up. Never throws:
 * a caption cleanup failure must not fail a hang-up. The cron sweep catches anything this misses.
 */
export async function stopCaptionsForCall(callId: string): Promise<void> {
  try {
    await clearCaptionConsents(callId);
    await endCaptionSessionsForCall(callId);
  } catch (err) {
    reportCaptionFailure("stop for call failed", err);
  }
}

/**
 * The cron's part (timeout-missed-calls, every minute): sessions whose paid lease ran out without a heartbeat (the app
 * was killed, went offline, or a modified client stopped reporting) are hung up. Nothing is refunded: the lease was
 * what they used.
 */
export async function sweepStaleCaptionSessions(now = new Date()): Promise<number> {
  const stale = await prisma.callCaptionSession.findMany({
    where: { endedAt: null, leaseUntil: { lt: now } },
    select: OPEN_SESSION_SELECT,
    orderBy: { leaseUntil: "asc" },
    take: 100,
  });
  return endSessions(stale, false);
}

