// Declining a ringing 1:1 call with a quick reply, like a phone's "Reply with message" (declineCallWithReply in
// actions/calls.ts). Pure and client-safe: the preset ids, the custom text's clean-up and cap, and the rule for which
// call a reply may be sent on. The reply is worded in the callee's language (the dictionary's calls.quickReply.presets)
// and becomes both the caller's "<name> replied: ..." notice and an ordinary chat message from the callee.

export const CALL_QUICK_REPLY_PRESET_IDS = [
  "meeting",
  "callBack",
  "cantTalk",
  "driving",
  "willText",
  "messageMe",
  "onMyWay",
] as const;

export type CallQuickReplyPresetId = (typeof CALL_QUICK_REPLY_PRESET_IDS)[number];

/** The longest custom reply, counted after clean-up (sanitizeCallReplyText). */
export const CALL_QUICK_REPLY_CUSTOM_MAX = 120;
/** What the server accepts as raw input before clean-up: room for whitespace that collapses away, nothing more. */
export const CALL_QUICK_REPLY_CUSTOM_RAW_MAX = 500;

export type CallQuickReplyChoice =
  | { kind: "preset"; presetId: CallQuickReplyPresetId }
  | { kind: "custom"; text: string };

// C0/C1 controls (tabs and line breaks become spaces below, before this runs), and the bidi embedding / override /
// isolate controls, which could make the caller's notice read differently from what was typed.
const STRIPPED = /[\u0000-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩﻿]/g;

/** A custom reply as it is sent: one line, whitespace collapsed, controls removed, trimmed. */
export function sanitizeCallReplyText(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(STRIPPED, "").replace(/ {2,}/g, " ").trim();
}

/**
 * The text a reply sends: a preset worded in the callee's language, or the cleaned-up custom text. Null when there is
 * nothing to send (custom text empty after clean-up) or it is too long.
 */
export function callQuickReplyContent(
  choice: CallQuickReplyChoice,
  presets: Record<CallQuickReplyPresetId, string>,
): string | null {
  if (choice.kind === "preset") return presets[choice.presetId] ?? null;
  const text = sanitizeCallReplyText(choice.text);
  if (!text || text.length > CALL_QUICK_REPLY_CUSTOM_MAX) return null;
  return text;
}

export type CallForQuickReply = {
  calleeId: string;
  status: "RINGING" | "ACCEPTED" | "DECLINED" | "ENDED" | "MISSED";
  /** CallParticipant rows: any means people were added, so it is no longer a plain 1:1 ring. */
  participantCount: number;
  declineReply: string | null;
};

/**
 * Whether `userId` may decline this call with a reply now. Only the callee of a plain 1:1 call still RINGING; a call
 * someone else is on, or that isn't 1:1, is "not_found" (nothing about it is revealed). A call already declined with a
 * reply is "already_replied" (a retry of the same reply: answered as done, nothing sent twice). Any other end (answered,
 * cancelled, timed out, declined without a reply) is "not_ringing": nothing is sent.
 */
export function callQuickReplyRefusal(
  call: CallForQuickReply | null,
  userId: string,
): "not_found" | "not_ringing" | "already_replied" | null {
  if (!call || call.calleeId !== userId || call.participantCount > 0) return "not_found";
  if (call.status === "RINGING") return null;
  if (call.status === "DECLINED" && call.declineReply !== null) return "already_replied";
  return "not_ringing";
}

/**
 * Whether the incoming-call card offers "Message": a 1:1 ring only (not a ring to join a call already going), and not
 * from a caller shown as "Private call" (the reader hid that chat; a reply would have to go into it).
 */
export function offersQuickReply(ring: { invite: boolean; privateCaller: boolean }): boolean {
  return !ring.invite && !ring.privateCaller;
}

/** The per-call key the reply's chat message is stored under (Message.clientRequestId): one message per call. */
export function callReplyRequestId(callId: string): string {
  return `call-reply:${callId}`;
}
