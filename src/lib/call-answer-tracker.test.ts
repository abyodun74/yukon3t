import { beforeEach, describe, expect, it } from "vitest";
import {
  OUT_OF_APP_ANSWER_ATTEMPTS,
  OUT_OF_APP_ANSWER_TTL_MS,
  SETTLED_ANSWER_TTL_MS,
  answerOutcome,
  createCallAnswerTracker,
  type CallAnswerTracker,
} from "@/lib/call-answer-tracker";

let clock: number;
let tracker: CallAnswerTracker;

beforeEach(() => {
  clock = 1_000_000;
  tracker = createCallAnswerTracker(() => clock);
});

describe("answerOutcome", () => {
  it("is connected when the server hands over the room and token", () => {
    expect(answerOutcome({ error: null, roomUrl: "https://x.daily.co/r", token: "t" })).toBe("connected");
  });

  it("is refused when the server says the ring is gone or not this user's", () => {
    expect(answerOutcome({ error: "invalid" })).toBe("refused");
    expect(answerOutcome({ error: "not_found" })).toBe("refused");
    expect(answerOutcome({ error: null, roomUrl: null, token: "t" })).toBe("refused");
  });

  it("is failed for a request that threw or a transient service error", () => {
    expect(answerOutcome(null)).toBe("failed");
    expect(answerOutcome({ error: "call_service_unavailable" })).toBe("failed");
  });
});

describe("CallKit / notification Accept (out of app)", () => {
  it("auto-accepts the ringing call instead of showing the in-app ring", () => {
    expect(tracker.noteOutOfAppAnswer("c1")).toBe(true);
    expect(tracker.ringDecision("c1")).toBe("accept");
  });

  it("hides the ring while the answer is being sent (the cold-start race)", () => {
    tracker.noteOutOfAppAnswer("c1");
    expect(tracker.begin("c1")).toBe(true);
    expect(tracker.ringDecision("c1")).toBe("hide");
  });

  it("still hides a ring check that resolves just after the answer went through", () => {
    tracker.noteOutOfAppAnswer("c1");
    tracker.begin("c1");
    expect(tracker.finish("c1", "connected")).toBe("done");
    expect(tracker.ringDecision("c1")).toBe("hide");
    clock += SETTLED_ANSWER_TTL_MS + 1;
    expect(tracker.ringDecision("c1")).toBe("show");
  });

  it("answers only once when the same answer arrives as a live event and from the pending queue", () => {
    expect(tracker.noteOutOfAppAnswer("c1")).toBe(true);
    tracker.begin("c1");
    expect(tracker.noteOutOfAppAnswer("c1")).toBe(false);
    expect(tracker.begin("c1")).toBe(false);
    tracker.finish("c1", "connected");
    expect(tracker.noteOutOfAppAnswer("c1")).toBe(false);
    expect(tracker.begin("c1")).toBe(false);
  });

  it("retries a failed send, then gives the in-app ring back", () => {
    tracker.noteOutOfAppAnswer("c1");
    for (let attempt = 1; attempt < OUT_OF_APP_ANSWER_ATTEMPTS; attempt++) {
      expect(tracker.begin("c1")).toBe(true);
      expect(tracker.finish("c1", "failed")).toBe("retry");
      expect(tracker.ringDecision("c1")).toBe("accept");
    }
    expect(tracker.begin("c1")).toBe(true);
    expect(tracker.finish("c1", "failed")).toBe("show");
    expect(tracker.ringDecision("c1")).toBe("show");
  });

  it("stops hiding a call the server refused once the settle window passes", () => {
    tracker.noteOutOfAppAnswer("c1");
    tracker.begin("c1");
    expect(tracker.finish("c1", "refused")).toBe("done");
    expect(tracker.ringDecision("c1")).toBe("hide");
    clock += SETTLED_ANSWER_TTL_MS + 1;
    expect(tracker.ringDecision("c1")).toBe("show");
  });

  it("forgets an answer that was never sent once the ring would have timed out", () => {
    tracker.noteOutOfAppAnswer("c1");
    clock += OUT_OF_APP_ANSWER_TTL_MS + 1;
    expect(tracker.ringDecision("c1")).toBe("show");
  });

  it("leaves other calls alone", () => {
    tracker.noteOutOfAppAnswer("c1");
    tracker.begin("c1");
    expect(tracker.ringDecision("c2")).toBe("show");
  });
});

describe("in-app Accept", () => {
  it("drops a second tap while the first is being sent", () => {
    expect(tracker.begin("c1")).toBe(true);
    expect(tracker.begin("c1")).toBe(false);
  });

  it("shows the ring again after a failed send so the user can retry", () => {
    tracker.begin("c1");
    expect(tracker.finish("c1", "failed")).toBe("show");
    expect(tracker.ringDecision("c1")).toBe("show");
  });
});

describe("out-of-app Decline", () => {
  it("declines once for a repeat delivery", () => {
    expect(tracker.noteOutOfAppDecline("c1")).toBe(true);
    expect(tracker.noteOutOfAppDecline("c1")).toBe(false);
    clock += SETTLED_ANSWER_TTL_MS + 1;
    expect(tracker.noteOutOfAppDecline("c1")).toBe(true);
  });
});
