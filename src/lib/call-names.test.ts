import { describe, expect, it } from "vitest";
import { answeredCallLabel, callLabel, isPrivateCaller } from "@/lib/call-names";
import { HIDDEN_CALLER_NAME } from "@/lib/hidden-chats-rules";
import { callsEn } from "@/lib/i18n/en/calls";

describe("answeredCallLabel", () => {
  it("keeps the in-app ring's label when that ring was loaded", () => {
    expect(answeredCallLabel("Ana + 2", "Ana", "Someone")).toBe("Ana + 2");
  });

  it("names the caller from respondToCall when answered before the in-app ring loaded (notification / CallKit Accept)", () => {
    expect(answeredCallLabel(null, "Ana", "Someone")).toBe("Ana");
  });

  it("keeps a hidden caller anonymous on that path too", () => {
    const label = answeredCallLabel(null, HIDDEN_CALLER_NAME, "Someone");
    expect(isPrivateCaller(label)).toBe(true);
    expect(callLabel(label, callsEn)).toBe(callsEn.privateCall);
  });

  it("falls back to the placeholder only for a caller with no name, or an answer that didn't say", () => {
    expect(answeredCallLabel(null, null, "Someone")).toBe("Someone");
    expect(answeredCallLabel(undefined, undefined, "Alguien")).toBe("Alguien");
  });
});
