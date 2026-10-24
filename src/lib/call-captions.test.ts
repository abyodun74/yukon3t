import { describe, expect, it } from "vitest";
import {
  CALL_CAPTION_MAX_ACTIVE_MS,
  CALL_CAPTION_MAX_CHARS,
  CALL_CAPTION_MONTHLY_SECONDS,
  captionFromAppMessage,
  captionIneligibility,
  captionMessage,
  captionMonth,
  captionPhase,
  captionSignal,
  captionSignalFromAppMessage,
  captionsActiveSince,
  captionsExpired,
  cleanCaptionText,
  consentColumn,
  consentOf,
  errorCodeFromRealtimeEvent,
  fitsMonthlyCap,
  isPlausibleSdpOffer,
  leaseChargeSeconds,
  leaseRefundSeconds,
  minutesLeft,
  providerCallIdFromLocation,
  transcriptFromRealtimeEvent,
  type CaptionCallFacts,
} from "./call-captions";

const call = (over: Partial<CaptionCallFacts> = {}): CaptionCallFacts => ({
  callerId: "a",
  calleeId: "b",
  status: "ACCEPTED",
  participantCount: 0,
  captionsCallerConsentAt: null,
  captionsCalleeConsentAt: null,
  ...over,
});

describe("consent", () => {
  it("is mutual: on only when both agreed, seen from either side", () => {
    expect(captionPhase({ mine: false, peer: false })).toBe("off");
    expect(captionPhase({ mine: true, peer: false })).toBe("waiting");
    expect(captionPhase({ mine: false, peer: true })).toBe("asked");
    expect(captionPhase({ mine: true, peer: true })).toBe("on");

    const askedByCaller = call({ captionsCallerConsentAt: new Date() });
    expect(captionPhase(consentOf(askedByCaller, "a"))).toBe("waiting");
    expect(captionPhase(consentOf(askedByCaller, "b"))).toBe("asked");
    const both = call({ captionsCallerConsentAt: new Date(), captionsCalleeConsentAt: new Date() });
    expect(captionPhase(consentOf(both, "a"))).toBe("on");
    expect(captionPhase(consentOf(both, "b"))).toBe("on");
  });

  it("files each person's agreement in their own column, and nobody else's", () => {
    expect(consentColumn(call(), "a")).toBe("captionsCallerConsentAt");
    expect(consentColumn(call(), "b")).toBe("captionsCalleeConsentAt");
    expect(consentColumn(call(), "c")).toBeNull();
  });

  it("exists only for the two people of a connected 1:1 call with no block", () => {
    expect(captionIneligibility(null, "a", false)).toBe("not_found");
    expect(captionIneligibility(call(), "stranger", false)).toBe("not_found");
    expect(captionIneligibility(call({ participantCount: 3 }), "a", false)).toBe("group");
    expect(captionIneligibility(call({ status: "ENDED" }), "a", false)).toBe("call_over");
    expect(captionIneligibility(call({ status: "RINGING" }), "b", false)).toBe("call_over");
    expect(captionIneligibility(call(), "a", true)).toBe("blocked");
    expect(captionIneligibility(call(), "b", false)).toBeNull();
  });

  it("turns off an hour after the later of the two agreements", () => {
    const first = new Date("2026-10-23T10:00:00Z");
    const second = new Date("2026-10-23T10:05:00Z");
    expect(captionsActiveSince(call({ captionsCallerConsentAt: first }))).toBeNull();
    const since = captionsActiveSince(call({ captionsCallerConsentAt: first, captionsCalleeConsentAt: second }));
    expect(since).toEqual(second);
    expect(captionsExpired(since, new Date(second.getTime() + CALL_CAPTION_MAX_ACTIVE_MS - 1))).toBe(false);
    expect(captionsExpired(since, new Date(second.getTime() + CALL_CAPTION_MAX_ACTIVE_MS))).toBe(true);
    expect(captionsExpired(null, new Date())).toBe(false);
  });
});

describe("monthly minutes", () => {
  it("keys usage by UTC month", () => {
    expect(captionMonth(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10");
    expect(captionMonth(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11");
    expect(captionMonth(new Date("2027-01-05T00:00:00Z"))).toBe("2027-01");
  });

  it("charges a lease extension only for the new stretch, and refunds what is left", () => {
    const now = new Date("2026-10-23T10:00:00Z");
    expect(leaseChargeSeconds(now, new Date(now.getTime() + 90_000))).toBe(90);
    expect(leaseChargeSeconds(new Date(now.getTime() + 90_000), new Date(now.getTime() + 45_000))).toBe(0);
    expect(leaseRefundSeconds(new Date(now.getTime() + 30_500), now)).toBe(30);
    expect(leaseRefundSeconds(new Date(now.getTime() - 5000), now)).toBe(0);
  });

  it("is a hard cap", () => {
    expect(CALL_CAPTION_MONTHLY_SECONDS).toBe(120 * 60);
    expect(fitsMonthlyCap(CALL_CAPTION_MONTHLY_SECONDS - 90, 90)).toBe(true);
    expect(fitsMonthlyCap(CALL_CAPTION_MONTHLY_SECONDS - 89, 90)).toBe(false);
    expect(minutesLeft(0)).toBe(120);
    expect(minutesLeft(CALL_CAPTION_MONTHLY_SECONDS + 500)).toBe(0);
  });
});

describe("text and messages", () => {
  it("cleans captions: control and bidi-override characters out, spaces collapsed, length capped", () => {
    expect(cleanCaptionText("  hola‮  mundo\u0007 ")).toBe("hola mundo");
    expect(cleanCaptionText(42)).toBe("");
    expect(cleanCaptionText("x".repeat(CALL_CAPTION_MAX_CHARS + 50))).toHaveLength(CALL_CAPTION_MAX_CHARS);
  });

  it("round-trips a caption and a signal through Daily app-messages, rejecting anything else", () => {
    expect(captionFromAppMessage(captionMessage("abc-1", "Hello there"))).toEqual({ id: "abc-1", text: "Hello there" });
    expect(captionFromAppMessage({ type: "call-caption", id: "bad id!", text: "x" })).toBeNull();
    expect(captionFromAppMessage({ type: "call-caption", id: "ok", text: "   " })).toBeNull();
    expect(captionFromAppMessage({ type: "call-hold", onHold: true })).toBeNull();
    expect(captionSignalFromAppMessage(captionSignal("changed"))).toBe("changed");
    expect(captionSignalFromAppMessage(captionSignal("cap_reached"))).toBe("cap_reached");
    expect(captionSignalFromAppMessage({ type: "call-captions-signal", signal: "on" })).toBeNull();
  });

  it("reads only finished transcripts from OpenAI's events, and only an error's code", () => {
    const done = JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "i1",
      transcript: " Where is the station? ",
    });
    expect(transcriptFromRealtimeEvent(done)).toBe("Where is the station?");
    expect(
      transcriptFromRealtimeEvent(JSON.stringify({ type: "conversation.item.input_audio_transcription.delta", delta: "Wh" })),
    ).toBeNull();
    expect(transcriptFromRealtimeEvent("not json")).toBeNull();
    const error = JSON.stringify({ type: "error", error: { code: "session_expired", message: "you said: secret words" } });
    expect(errorCodeFromRealtimeEvent(error)).toBe("session_expired");
    expect(errorCodeFromRealtimeEvent(done)).toBeNull();
  });

  it("takes OpenAI's call id from the Location header", () => {
    expect(providerCallIdFromLocation("/v1/realtime/calls/rtc_abc123")).toBe("rtc_abc123");
    expect(providerCallIdFromLocation("https://api.openai.com/v1/realtime/calls/rtc_x9Z?x=1")).toBe("rtc_x9Z");
    expect(providerCallIdFromLocation(null)).toBeNull();
    expect(providerCallIdFromLocation("/v1/realtime/calls/../../x y")).toBeNull();
  });

  it("accepts only something shaped like an SDP offer", () => {
    expect(isPlausibleSdpOffer("v=0\r\no=- 1 2 IN IP4 127.0.0.1")).toBe(true);
    expect(isPlausibleSdpOffer("hello")).toBe(false);
    expect(isPlausibleSdpOffer(`v=0${"a".repeat(30_000)}`)).toBe(false);
  });
});
