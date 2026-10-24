"use server";

import { requireVerifiedUser } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { getLocale } from "@/lib/i18n/server";
import {
  callCaptionCallSchema,
  callCaptionConsentSchema,
  callCaptionSessionSchema,
  callCaptionStartSchema,
  callCaptionTranslateSchema,
} from "@/lib/validations";
import {
  CALL_CAPTION_HEARTBEAT_MS,
  CALL_CAPTION_LEASE_SECONDS,
  CALL_CAPTION_MONTHLY_SECONDS,
  captionMonth,
  captionPhase,
  captionsActiveSince,
  captionsExpired,
  cleanCaptionText,
  consentColumn,
  consentOf,
  isPlausibleSdpOffer,
  leaseChargeSeconds,
  minutesLeft,
  type CaptionIneligibility,
  type CaptionPhase,
} from "@/lib/call-captions";
import {
  chargeCaptionSeconds,
  clearCaptionConsents,
  endCaptionSessionsForCall,
  endUserCaptionSessions,
  isCallCaptionsConfigured,
  loadCaptionContext,
  openCaptionTranscription,
  usedCaptionSeconds,
} from "@/lib/call-captions-server";
import { callTranslationModel } from "@/lib/translation-server";
import { detectLanguage, isSameLanguageResult, isTranslatable } from "@/lib/translation";

// Live translated captions in a 1:1 call (rules and the full picture: src/lib/call-captions.ts). Every action
// re-derives the person from the session, checks they are the caller or callee of a connected, still-1:1 call with
// nobody blocked either way, and validates its input. None of them stores or logs any text.

export type CallCaptionsState =
  | {
      available: false;
      reason: "not_configured" | CaptionIneligibility;
    }
  | {
      available: true;
      phase: CaptionPhase;
      /** Minutes of this person's own speech still available this month. */
      minutesLeft: number;
    };

async function stateFor(userId: string, callId: string): Promise<CallCaptionsState> {
  if (!isCallCaptionsConfigured()) return { available: false, reason: "not_configured" };
  const { call, ineligible } = await loadCaptionContext(userId, callId);
  if (!call || ineligible) return { available: false, reason: ineligible ?? "not_found" };
  const now = new Date();
  if (captionsExpired(captionsActiveSince(call), now)) {
    // An hour after both agreed, captions turn off by themselves (they can be asked for again).
    await clearCaptionConsents(callId);
    await endCaptionSessionsForCall(callId);
    return { available: true, phase: "off", minutesLeft: minutesLeft(await usedCaptionSeconds(userId, now)) };
  }
  return {
    available: true,
    phase: captionPhase(consentOf(call, userId)),
    minutesLeft: minutesLeft(await usedCaptionSeconds(userId, now)),
  };
}

/** The caption state of a call for the person asking. */
export async function getCallCaptionsState(
  input: unknown,
): Promise<{ error: "invalid" | "rate_limited" | null; state: CallCaptionsState | null }> {
  const user = await requireVerifiedUser();
  const parsed = callCaptionCallSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid", state: null };
  if (!(await checkRateLimit("callCaptionState", user.id))) return { error: "rate_limited", state: null };
  return { error: null, state: await stateFor(user.id, parsed.data.callId) };
}

/**
 * `on: true` is this person's agreement (asking, or allowing the other person's request): it needs minutes left this
 * month. `on: false` turns captions off for BOTH people and hangs every transcription session up, from either side,
 * at any time; it is also how "Not now" answers a request.
 */
export async function setCallCaptionsConsent(input: unknown): Promise<{
  error: "invalid" | "rate_limited" | "unavailable" | "cap_reached" | null;
  state: CallCaptionsState | null;
}> {
  const user = await requireVerifiedUser();
  const parsed = callCaptionConsentSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid", state: null };
  const { callId, on } = parsed.data;
  if (!(await checkRateLimit("callCaptionConsent", user.id))) return { error: "rate_limited", state: null };

  const { call, ineligible } = await loadCaptionContext(user.id, callId);
  if (!call) return { error: "unavailable", state: null };

  if (!on) {
    // Allowed whatever else is true, as long as this is their call: switching off must always work.
    await clearCaptionConsents(callId);
    await endCaptionSessionsForCall(callId);
    return { error: null, state: await stateFor(user.id, callId) };
  }

  if (!isCallCaptionsConfigured() || ineligible) return { error: "unavailable", state: await stateFor(user.id, callId) };
  if ((await usedCaptionSeconds(user.id)) >= CALL_CAPTION_MONTHLY_SECONDS) {
    return { error: "cap_reached", state: await stateFor(user.id, callId) };
  }
  const column = consentColumn(call, user.id);
  if (!column) return { error: "unavailable", state: null };
  // Guarded on the call still being connected and 1:1 (no participant rows) at the moment of writing.
  await prisma.call.updateMany({
    where: { id: callId, status: "ACCEPTED", participants: { none: {} }, [column]: null },
    data: { [column]: new Date() },
  });
  return { error: null, state: await stateFor(user.id, callId) };
}

/**
 * Starts transcribing this person's own microphone: both must have agreed, there must be minutes left (one lease is
 * charged up front), and the browser's SDP offer is exchanged with OpenAI here (src/lib/call-captions-server.ts). The
 * answer is all the browser gets back.
 */
export async function startCallCaptionSession(input: unknown): Promise<
  | { error: "invalid" | "rate_limited" | "unavailable" | "consent_required" | "cap_reached"; session: null }
  | { error: null; session: { id: string; sdp: string; heartbeatMs: number } }
> {
  const user = await requireVerifiedUser();
  const parsed = callCaptionStartSchema.safeParse(input);
  if (!parsed.success || !isPlausibleSdpOffer(parsed.data.sdp)) return { error: "invalid", session: null };
  const { callId, sdp } = parsed.data;
  if (!isCallCaptionsConfigured()) return { error: "unavailable", session: null };
  const [mine, everyone] = await Promise.all([
    checkRateLimit("callCaptionStart", user.id),
    checkRateLimit("callCaptionGlobal", "all"),
  ]);
  if (!mine || !everyone) return { error: "rate_limited", session: null };

  const { call, ineligible } = await loadCaptionContext(user.id, callId);
  if (!call || ineligible) return { error: "unavailable", session: null };
  if (captionPhase(consentOf(call, user.id)) !== "on") return { error: "consent_required", session: null };
  if (captionsExpired(captionsActiveSince(call), new Date())) return { error: "consent_required", session: null };

  // A restart (the connection to OpenAI dropped) replaces whatever this person still had open in this call.
  await endUserCaptionSessions(user.id, callId);

  const startedAt = new Date();
  if (!(await chargeCaptionSeconds(user.id, CALL_CAPTION_LEASE_SECONDS, startedAt))) {
    return { error: "cap_reached", session: null };
  }
  const opened = await openCaptionTranscription(sdp);
  if (!opened) {
    // Nothing ran: give the lease back.
    await prisma.callCaptionUsage.updateMany({
      where: { userId: user.id, month: captionMonth(startedAt), seconds: { gte: CALL_CAPTION_LEASE_SECONDS } },
      data: { seconds: { decrement: CALL_CAPTION_LEASE_SECONDS } },
    });
    return { error: "unavailable", session: null };
  }
  const session = await prisma.callCaptionSession.create({
    data: {
      callId,
      userId: user.id,
      providerCallId: opened.providerCallId,
      startedAt,
      leaseUntil: new Date(startedAt.getTime() + CALL_CAPTION_LEASE_SECONDS * 1000),
    },
    select: { id: true },
  });

  // Consent can have been withdrawn while OpenAI was answering: check once more, and end at once if so.
  const after = await loadCaptionContext(user.id, callId);
  if (!after.call || after.ineligible || captionPhase(consentOf(after.call, user.id)) !== "on") {
    await endUserCaptionSessions(user.id, callId, session.id);
    return { error: "consent_required", session: null };
  }
  return { error: null, session: { id: session.id, sdp: opened.sdpAnswer, heartbeatMs: CALL_CAPTION_HEARTBEAT_MS } };
}

export type CaptionStopReason = "ended" | "consent_required" | "unavailable" | "cap_reached" | "max_duration";

/**
 * A running session reporting in: re-checks everything and pays for the next stretch. `stop` set means the session
 * has been ended here (and hung up at OpenAI), and the browser must close its side.
 */
export async function heartbeatCallCaptionSession(input: unknown): Promise<{
  error: "invalid" | "rate_limited" | null;
  stop: CaptionStopReason | null;
}> {
  const user = await requireVerifiedUser();
  const parsed = callCaptionSessionSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid", stop: null };
  // A heartbeat refused by the limiter just doesn't extend the lease; the cron ends the session when it runs out.
  if (!(await checkRateLimit("callCaptionHeartbeat", user.id))) return { error: "rate_limited", stop: null };

  const session = await prisma.callCaptionSession.findFirst({
    where: { id: parsed.data.sessionId, userId: user.id, endedAt: null },
    select: { id: true, callId: true, leaseUntil: true },
  });
  if (!session) return { error: null, stop: "ended" };

  const end = async (stop: CaptionStopReason) => {
    await endUserCaptionSessions(user.id, session.callId, session.id);
    return { error: null, stop };
  };

  if (!isCallCaptionsConfigured()) return end("unavailable");
  const { call, ineligible } = await loadCaptionContext(user.id, session.callId);
  if (!call || ineligible) return end("unavailable");
  if (captionPhase(consentOf(call, user.id)) !== "on") return end("consent_required");
  const now = new Date();
  if (captionsExpired(captionsActiveSince(call), now)) {
    await clearCaptionConsents(session.callId);
    await endCaptionSessionsForCall(session.callId);
    return { error: null, stop: "max_duration" };
  }
  if (!(await checkRateLimit("callCaptionGlobal", "all"))) return end("unavailable");

  const newLease = new Date(now.getTime() + CALL_CAPTION_LEASE_SECONDS * 1000);
  const charge = leaseChargeSeconds(session.leaseUntil, newLease);
  if (!(await chargeCaptionSeconds(user.id, charge, now))) return end("cap_reached");
  const { count } = await prisma.callCaptionSession.updateMany({
    where: { id: session.id, endedAt: null },
    data: { leaseUntil: newLease },
  });
  // Ended in the meantime (a stop, the cron, the call ending): what was just charged is unused.
  if (count === 0) {
    await prisma.callCaptionUsage.updateMany({
      where: { userId: user.id, month: captionMonth(now), seconds: { gte: charge } },
      data: { seconds: { decrement: charge } },
    });
    return { error: null, stop: "ended" };
  }
  return { error: null, stop: null };
}

/** This person's own session stopping (they or the other person switched off, the call ended, the screen closed). */
export async function stopCallCaptionSession(input: unknown): Promise<{ error: "invalid" | null }> {
  const user = await requireVerifiedUser();
  const parsed = callCaptionSessionSchema.safeParse(input);
  if (!parsed.success) return { error: "invalid" };
  const session = await prisma.callCaptionSession.findFirst({
    where: { id: parsed.data.sessionId, userId: user.id, endedAt: null },
    select: { callId: true },
  });
  if (session) await endUserCaptionSessions(user.id, session.callId, parsed.data.sessionId);
  return { error: null };
}

export type CaptionTranslationResult =
  | { status: "translated"; text: string }
  | { status: "same_language" }
  | { status: "unavailable" }
  | { status: "rate_limited" };

/**
 * Translates one sentence the OTHER person said into this person's app language. The text comes from their phone (it
 * is never stored by YuKon3t, so there is no id to load it by); it is only translated while captions are on in a call
 * this person is in. Skipped (answered same_language, no model call) when the text is clearly already in the
 * reader's language or too short to be worth it. The text goes to the model only as a JSON-escaped data field
 * (buildTranslationMessages); it is never logged and never sent to error reporting.
 */
export async function translateCallCaption(input: unknown): Promise<CaptionTranslationResult> {
  const user = await requireVerifiedUser();
  const parsed = callCaptionTranslateSchema.safeParse(input);
  if (!parsed.success) return { status: "unavailable" };
  const text = cleanCaptionText(parsed.data.text);
  if (!text || !isCallCaptionsConfigured()) return { status: "unavailable" };

  const { call, ineligible } = await loadCaptionContext(user.id, parsed.data.callId);
  if (!call || ineligible || captionPhase(consentOf(call, user.id)) !== "on") return { status: "unavailable" };

  const target = await getLocale();
  if (!isTranslatable(text) || detectLanguage(text) === target) return { status: "same_language" };

  const [mine, everyone] = await Promise.all([
    checkRateLimit("callCaptionTranslate", user.id),
    checkRateLimit("callCaptionTranslateGlobal", "all"),
  ]);
  if (!mine || !everyone) return { status: "rate_limited" };

  const result = await callTranslationModel(text, target);
  if (!result) return { status: "unavailable" };
  if (isSameLanguageResult(result, text, target)) return { status: "same_language" };
  return { status: "translated", text: result.translation };
}
