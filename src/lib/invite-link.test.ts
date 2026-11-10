import { describe, expect, it } from "vitest";
import {
  buildInviteMessage,
  buildInviteUrl,
  buildSmsInviteHref,
  buildWhatsAppInviteHref,
} from "@/lib/invite-link";
import { inviteEn } from "@/lib/i18n/en/invite";
import { invite as inviteEs } from "@/lib/i18n/es/invite";
import { invite as inviteFr } from "@/lib/i18n/fr/invite";
import { invite as invitePt } from "@/lib/i18n/pt/invite";
import { invite as inviteAr } from "@/lib/i18n/ar/invite";

const URL_ = "https://yukon3t.com/sign-up";

describe("buildInviteUrl", () => {
  it("is always the canonical production link, whatever host the page is on", () => {
    expect(buildInviteUrl()).toBe(URL_);
  });
});

describe("buildInviteMessage", () => {
  it("puts the link alone on the last line so it stays tappable", () => {
    const text = buildInviteMessage("Join me on YuKon3t:");
    expect(text).toBe(`Join me on YuKon3t:\n${URL_}`);
    expect(text.endsWith(URL_)).toBe(true);
  });

  it("includes the exact link in every language", () => {
    for (const t of [inviteEn, inviteEs, inviteFr, invitePt, inviteAr]) {
      const text = buildInviteMessage(t.message);
      expect(text.split("\n").pop()).toBe(URL_);
      expect(text.startsWith(t.message.trim())).toBe(true);
    }
  });

  it("is just the link with no sentence", () => {
    expect(buildInviteMessage("  ")).toBe(URL_);
  });
});

describe("buildSmsInviteHref", () => {
  const message = buildInviteMessage(inviteFr.message);

  it("dials the number as + and digits and carries the whole message, URL-encoded", () => {
    const href = buildSmsInviteHref("+1 (415) 555-0132", message);
    expect(href.startsWith("sms:+14155550132?body=")).toBe(true);
    const body = href.slice(href.indexOf("?body=") + 6);
    expect(body).not.toMatch(/[\s&#?]/);
    expect(decodeURIComponent(body)).toBe(message);
    expect(decodeURIComponent(body)).toContain(URL_);
  });

  it("keeps a number without a country code as digits", () => {
    expect(buildSmsInviteHref("72-345", "x")).toBe("sms:72345?body=x");
  });
});

describe("buildWhatsAppInviteHref", () => {
  const message = buildInviteMessage(inviteAr.message);

  it("opens that person's chat for an international number", () => {
    const href = new URL(buildWhatsAppInviteHref(message, "+447400123456"));
    expect(href.origin + href.pathname).toBe("https://wa.me/447400123456");
    expect(href.searchParams.get("text")).toBe(message);
  });

  it("opens WhatsApp's picker without a usable number", () => {
    for (const tel of [null, undefined, "", "72345"]) {
      const href = new URL(buildWhatsAppInviteHref(message, tel));
      expect(href.pathname).toBe("/");
      expect(href.searchParams.get("text")).toContain(URL_);
    }
  });
});
