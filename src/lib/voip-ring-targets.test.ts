import { describe, expect, it } from "vitest";
import {
  NO_VOIP_ANSWER_RECORD,
  VOIP_TOKEN_MAX_LENGTH,
  callKitEndedToken,
  parseCallDevice,
  participantAnswerRecord,
  planHangUpVoipCancel,
  planResponderVoipCancel,
} from "@/lib/voip-ring-targets";

const phoneA = { id: "tA", token: "aaaa" };
const phoneB = { id: "tB", token: "bbbb" };
const phoneC = { id: "tC", token: "cccc" };
const tokens = [phoneA, phoneB, phoneC];

describe("parseCallDevice", () => {
  it("accepts the two shapes the page sends", () => {
    expect(parseCallDevice({ platform: "other" })).toEqual({ platform: "other" });
    expect(parseCallDevice({ platform: "ios", voipToken: "aaaa" })).toEqual({
      platform: "ios",
      voipToken: "aaaa",
      callKitEnded: false,
    });
    expect(parseCallDevice({ platform: "ios", voipToken: "aaaa", callKitEnded: true })).toEqual({
      platform: "ios",
      voipToken: "aaaa",
      callKitEnded: true,
    });
  });

  it("drops a missing, empty, non-string or oversized token", () => {
    for (const voipToken of [undefined, null, "", 42, "x".repeat(VOIP_TOKEN_MAX_LENGTH + 1)]) {
      expect(parseCallDevice({ platform: "ios", voipToken })).toEqual({
        platform: "ios",
        voipToken: null,
        callKitEnded: false,
      });
    }
  });

  it("only a literal true counts as callKitEnded", () => {
    expect(parseCallDevice({ platform: "ios", voipToken: "aaaa", callKitEnded: "true" })).toMatchObject({
      callKitEnded: false,
    });
  });

  it("rejects anything else", () => {
    for (const input of [undefined, null, "ios", 1, {}, { platform: "android" }, []]) {
      expect(parseCallDevice(input)).toBeNull();
    }
  });
});

describe("planResponderVoipCancel", () => {
  it("cancels every other iPhone, never the one that answered, and records it", () => {
    const plan = planResponderVoipCancel(tokens, { platform: "ios", voipToken: "aaaa", callKitEnded: false });
    expect(plan.cancel).toEqual([phoneB, phoneC]);
    expect(plan.record).toEqual({ voipOthersCleared: true, answerVoipTokenId: "tA" });
  });

  it("cancels every iPhone when the answer came from Android or a browser", () => {
    const plan = planResponderVoipCancel(tokens, { platform: "other" });
    expect(plan.cancel).toEqual(tokens);
    expect(plan.record).toEqual({ voipOthersCleared: true, answerVoipTokenId: null });
  });

  it("sends nothing from an iPhone whose token the page doesn't know (it can't be told apart)", () => {
    const plan = planResponderVoipCancel(tokens, { platform: "ios", voipToken: null, callKitEnded: false });
    expect(plan).toEqual({ cancel: [], record: NO_VOIP_ANSWER_RECORD });
  });

  it("sends nothing for a token that isn't one of this user's (someone else's, or a stale one)", () => {
    const plan = planResponderVoipCancel(tokens, { platform: "ios", voipToken: "someone-elses", callKitEnded: false });
    expect(plan).toEqual({ cancel: [], record: NO_VOIP_ANSWER_RECORD });
  });

  it("sends nothing for a page that sent no device", () => {
    expect(planResponderVoipCancel(tokens, null)).toEqual({ cancel: [], record: NO_VOIP_ANSWER_RECORD });
  });

  it("an only iPhone that answered gets nothing", () => {
    const plan = planResponderVoipCancel([phoneA], { platform: "ios", voipToken: "aaaa", callKitEnded: false });
    expect(plan.cancel).toEqual([]);
    expect(plan.record.answerVoipTokenId).toBe("tA");
  });
});

describe("planHangUpVoipCancel", () => {
  it("without a record, every iPhone (as before)", () => {
    expect(planHangUpVoipCancel(tokens, NO_VOIP_ANSWER_RECORD, null)).toEqual(tokens);
  });

  it("after the others were cleared, only the iPhone that answered", () => {
    expect(planHangUpVoipCancel(tokens, { voipOthersCleared: true, answerVoipTokenId: "tB" }, null)).toEqual([phoneB]);
  });

  it("after an Android or browser answer, no iPhone", () => {
    expect(planHangUpVoipCancel(tokens, { voipOthersCleared: true, answerVoipTokenId: null }, null)).toEqual([]);
  });

  it("an answering token since unregistered gets nothing", () => {
    expect(planHangUpVoipCancel(tokens, { voipOthersCleared: true, answerVoipTokenId: "gone" }, null)).toEqual([]);
  });

  it("leaves out the iPhone whose CallKit End made the hang-up", () => {
    expect(planHangUpVoipCancel(tokens, { voipOthersCleared: true, answerVoipTokenId: "tA" }, "aaaa")).toEqual([]);
    expect(planHangUpVoipCancel(tokens, NO_VOIP_ANSWER_RECORD, "aaaa")).toEqual([phoneB, phoneC]);
  });
});

describe("callKitEndedToken", () => {
  it("is the token only for a CallKit End on an iPhone", () => {
    expect(callKitEndedToken({ platform: "ios", voipToken: "aaaa", callKitEnded: true })).toBe("aaaa");
    expect(callKitEndedToken({ platform: "ios", voipToken: "aaaa", callKitEnded: false })).toBeNull();
    expect(callKitEndedToken({ platform: "ios", voipToken: null, callKitEnded: true })).toBeNull();
    expect(callKitEndedToken({ platform: "other" })).toBeNull();
    expect(callKitEndedToken(null)).toBeNull();
  });
});

describe("participantAnswerRecord", () => {
  const call = { calleeId: "callee", voipOthersCleared: true, answerVoipTokenId: "tA" };

  it("the original callee's backfilled row uses the call's answer", () => {
    const row = { userId: "callee", invitedById: null, ...NO_VOIP_ANSWER_RECORD };
    expect(participantAnswerRecord(call, row)).toEqual({ voipOthersCleared: true, answerVoipTokenId: "tA" });
  });

  it("someone added later uses their own row", () => {
    const row = { userId: "guest", invitedById: "callee", voipOthersCleared: true, answerVoipTokenId: "tG" };
    expect(participantAnswerRecord(call, row)).toEqual({ voipOthersCleared: true, answerVoipTokenId: "tG" });
  });

  it("the callee re-invited after leaving uses their own row", () => {
    const row = { userId: "callee", invitedById: "caller", ...NO_VOIP_ANSWER_RECORD };
    expect(participantAnswerRecord(call, row)).toEqual(NO_VOIP_ANSWER_RECORD);
  });
});
