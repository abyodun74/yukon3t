import { CALL_RING_TIMEOUT_MS } from "@/lib/call-resilience";

// Which calls this page is answering, or has just answered, so a ring the server still reports as RINGING is never
// shown as a second Accept screen. Pure: IncomingCallListener owns one instance per mount.
//
// An answer tapped outside the in-app ring (CallKit's Accept on iOS, the incoming-call notification's Accept on
// Android) reaches the page some time after the tap: on a cold start, or when the app comes back from the background,
// the page checks for a ringing call at the same moment the answer is being sent, and that check used to come back
// first and put up the in-app ring with its own Accept button.

/** How long an Accept tapped outside the app keeps auto-accepting its call: the ring's own lifetime plus a margin. */
export const OUT_OF_APP_ANSWER_TTL_MS = CALL_RING_TIMEOUT_MS + 30_000;
/**
 * How long a call stays hidden after its answer went through or was refused. Covers a ring check that was already
 * in flight when the answer landed (a sub-second race) without hiding a later re-invite into the same call for long.
 */
export const SETTLED_ANSWER_TTL_MS = 15_000;
/** Attempts at sending an out-of-app answer before falling back to the in-app ring. */
export const OUT_OF_APP_ANSWER_ATTEMPTS = 3;
export const OUT_OF_APP_ANSWER_RETRY_DELAY_MS = 1_500;

export type RingDecision = "show" | "accept" | "hide";
export type AnswerOutcome = "connected" | "refused" | "failed";
export type AnswerFollowUp = "done" | "retry" | "show";

type RespondResult = { error: string | null; roomUrl?: string | null; token?: string | null } | null;

/**
 * What respondToCall's answer means for the call. `null` is a request that threw (no network, the app suspended
 * mid-request). The server refusing (`not_found`, `invalid`: someone else resolved the ring, or it was never this
 * user's) is final; `call_service_unavailable` is a transient failure worth another try.
 */
export function answerOutcome(result: RespondResult): AnswerOutcome {
  if (!result || result.error === "call_service_unavailable") return "failed";
  if (result.error || !result.roomUrl || !result.token) return "refused";
  return "connected";
}

export function createCallAnswerTracker(now: () => number = Date.now) {
  const outOfApp = new Map<string, { at: number; attempts: number }>();
  const inFlight = new Set<string>();
  const settled = new Map<string, number>();
  const declined = new Map<string, number>();

  function prune() {
    const t = now();
    for (const [id, entry] of outOfApp) if (t - entry.at > OUT_OF_APP_ANSWER_TTL_MS) outOfApp.delete(id);
    for (const [id, at] of settled) if (t - at > SETTLED_ANSWER_TTL_MS) settled.delete(id);
    for (const [id, at] of declined) if (t - at > SETTLED_ANSWER_TTL_MS) declined.delete(id);
  }

  return {
    /**
     * An Accept tapped outside the in-app ring. True when the caller should start answering now; false for a repeat
     * delivery of an answer already being handled (iOS reports the same CallKit answer both as a live event and in its
     * pending queue).
     */
    noteOutOfAppAnswer(callId: string): boolean {
      prune();
      if (inFlight.has(callId) || settled.has(callId) || outOfApp.has(callId)) return false;
      outOfApp.set(callId, { at: now(), attempts: 0 });
      return true;
    },

    /** A Decline tapped outside the app. False for a repeat delivery of the same decline. */
    noteOutOfAppDecline(callId: string): boolean {
      prune();
      if (declined.has(callId)) return false;
      declined.set(callId, now());
      return true;
    },

    /** Claims the answer for `callId`. False while another answer for it is running or has just finished. */
    begin(callId: string): boolean {
      prune();
      if (inFlight.has(callId) || settled.has(callId)) return false;
      inFlight.add(callId);
      return true;
    },

    /**
     * Records how an answer ended. "retry": an out-of-app answer that failed and has attempts left; "show": give the
     * in-app ring back (an in-app Accept that failed, or an out-of-app one out of attempts) so the user can still pick
     * up; "done": nothing more to do.
     */
    finish(callId: string, outcome: AnswerOutcome): AnswerFollowUp {
      inFlight.delete(callId);
      if (outcome !== "failed") {
        outOfApp.delete(callId);
        settled.set(callId, now());
        return "done";
      }
      const entry = outOfApp.get(callId);
      if (!entry) return "show";
      entry.attempts += 1;
      if (entry.attempts < OUT_OF_APP_ANSWER_ATTEMPTS) return "retry";
      outOfApp.delete(callId);
      return "show";
    },

    /** What to do with a call the server reports as ringing for this user. */
    ringDecision(callId: string): RingDecision {
      prune();
      if (inFlight.has(callId) || settled.has(callId)) return "hide";
      if (outOfApp.has(callId)) return "accept";
      return "show";
    },
  };
}

export type CallAnswerTracker = ReturnType<typeof createCallAnswerTracker>;
