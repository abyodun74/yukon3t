import { describe, expect, it } from "vitest";
import { callsEn } from "@/lib/i18n/en/calls";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import {
  CALL_QUICK_REPLY_CUSTOM_MAX,
  CALL_QUICK_REPLY_PRESET_IDS,
  callQuickReplyContent,
  callQuickReplyRefusal,
  callReplyRequestId,
  offersQuickReply,
  sanitizeCallReplyText,
  type CallForQuickReply,
} from "@/lib/call-quick-reply";

const presets = callsEn.quickReply.presets;

describe("sanitizeCallReplyText", () => {
  it("makes one trimmed line with single spaces", () => {
    expect(sanitizeCallReplyText("  running\n\nlate \t sorry  ")).toBe("running late sorry");
  });

  it("drops control and bidi override characters", () => {
    expect(sanitizeCallReplyText("ok\u0000\u0007 now")).toBe("ok now");
    expect(sanitizeCallReplyText("‮gnimoc‬ I'm")).toBe("gnimoc I'm");
    expect(sanitizeCallReplyText("a⁦b⁩c‏d﻿")).toBe("abcd");
  });

  it("keeps letters, emoji and right-to-left text as typed", () => {
    expect(sanitizeCallReplyText("أنا مشغول 🙏")).toBe("أنا مشغول 🙏");
  });
});

describe("callQuickReplyContent", () => {
  it("words a preset in the dictionary's language", () => {
    expect(callQuickReplyContent({ kind: "preset", presetId: "meeting" }, presets)).toBe("I'm in a meeting.");
    const es = DICTIONARIES.es.calls.quickReply.presets;
    expect(callQuickReplyContent({ kind: "preset", presetId: "driving" }, es)).toBe(es.driving);
  });

  it("sends cleaned-up custom text", () => {
    expect(callQuickReplyContent({ kind: "custom", text: "  back \n in 5 " }, presets)).toBe("back in 5");
  });

  it("refuses custom text that is empty after clean-up or too long", () => {
    expect(callQuickReplyContent({ kind: "custom", text: " \n‮ " }, presets)).toBeNull();
    expect(callQuickReplyContent({ kind: "custom", text: "x".repeat(CALL_QUICK_REPLY_CUSTOM_MAX) }, presets)).toHaveLength(
      CALL_QUICK_REPLY_CUSTOM_MAX,
    );
    expect(callQuickReplyContent({ kind: "custom", text: "x".repeat(CALL_QUICK_REPLY_CUSTOM_MAX + 1) }, presets)).toBeNull();
  });

  it("measures the cap after whitespace collapses", () => {
    const padded = `${"x".repeat(CALL_QUICK_REPLY_CUSTOM_MAX)}${" ".repeat(50)}`;
    expect(callQuickReplyContent({ kind: "custom", text: padded }, presets)).toHaveLength(CALL_QUICK_REPLY_CUSTOM_MAX);
  });

  it("has every preset worded, short and distinct in every language", () => {
    for (const [locale, dict] of Object.entries(DICTIONARIES)) {
      const texts = CALL_QUICK_REPLY_PRESET_IDS.map((id) => dict.calls.quickReply.presets[id]);
      for (const text of texts) {
        expect(text.trim(), locale).not.toBe("");
        expect(text.length, locale).toBeLessThanOrEqual(CALL_QUICK_REPLY_CUSTOM_MAX);
      }
      expect(new Set(texts).size, locale).toBe(texts.length);
    }
  });
});

describe("callQuickReplyRefusal", () => {
  const ringing: CallForQuickReply = { calleeId: "me", status: "RINGING", participantCount: 0, declineReply: null };

  it("allows the callee of a ringing 1:1 call", () => {
    expect(callQuickReplyRefusal(ringing, "me")).toBeNull();
  });

  it("is not_found for a missing call, someone else's call, or a call people were added to", () => {
    expect(callQuickReplyRefusal(null, "me")).toBe("not_found");
    expect(callQuickReplyRefusal(ringing, "caller")).toBe("not_found");
    expect(callQuickReplyRefusal(ringing, "stranger")).toBe("not_found");
    expect(callQuickReplyRefusal({ ...ringing, participantCount: 3 }, "me")).toBe("not_found");
  });

  it.each(["ACCEPTED", "ENDED", "MISSED"] as const)("is not_ringing once the call is %s", (status) => {
    expect(callQuickReplyRefusal({ ...ringing, status }, "me")).toBe("not_ringing");
  });

  it("tells a plain decline from a reply already sent", () => {
    expect(callQuickReplyRefusal({ ...ringing, status: "DECLINED" }, "me")).toBe("not_ringing");
    expect(callQuickReplyRefusal({ ...ringing, status: "DECLINED", declineReply: "On my way." }, "me")).toBe(
      "already_replied",
    );
  });
});

describe("offersQuickReply", () => {
  it("offers it for a named 1:1 ring only", () => {
    expect(offersQuickReply({ invite: false, privateCaller: false })).toBe(true);
    expect(offersQuickReply({ invite: true, privateCaller: false })).toBe(false);
    expect(offersQuickReply({ invite: false, privateCaller: true })).toBe(false);
  });
});

describe("callReplyRequestId", () => {
  it("is one key per call", () => {
    expect(callReplyRequestId("c1")).toBe("call-reply:c1");
    expect(callReplyRequestId("c1")).not.toBe(callReplyRequestId("c2"));
  });
});
