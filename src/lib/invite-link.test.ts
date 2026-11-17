import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APP_STORE_URL,
  INVITE_STORE_LINKS,
  PLAY_STORE_URL,
  buildInviteMessage,
  buildSmsInviteHref,
  buildWhatsAppInviteHref,
} from "@/lib/invite-link";
import { APP_PACKAGE_ID, isOpenableStoreLink, sanitizeStoreUrl } from "@/lib/app-version";
import { inviteEn } from "@/lib/i18n/en/invite";
import { invite as inviteEs } from "@/lib/i18n/es/invite";
import { invite as inviteFr } from "@/lib/i18n/fr/invite";
import { invite as invitePt } from "@/lib/i18n/pt/invite";
import { invite as inviteAr } from "@/lib/i18n/ar/invite";
import { invite as inviteDe } from "@/lib/i18n/de/invite";
import { invite as inviteIt } from "@/lib/i18n/it/invite";
import { invite as inviteHi } from "@/lib/i18n/hi/invite";
import { invite as inviteSw } from "@/lib/i18n/sw/invite";

const APP = "https://apps.apple.com/app/id6813083874";
const PLAY = "https://play.google.com/store/apps/details?id=com.yukon3t.app";
const LINES = `iPhone: ${APP}\nAndroid: ${PLAY}`;

describe("store links", () => {
  it("are exactly the App Store and Play Store listings", () => {
    expect(APP_STORE_URL).toBe(APP);
    expect(PLAY_STORE_URL).toBe(PLAY);
  });

  it("build the Play URL from the app's package id", () => {
    expect(PLAY_STORE_URL).toBe(`https://play.google.com/store/apps/details?id=${APP_PACKAGE_ID}`);
  });

  it("are links the app itself accepts as store links", () => {
    for (const url of [APP_STORE_URL, PLAY_STORE_URL]) {
      expect(sanitizeStoreUrl(url)).toBe(url);
      expect(isOpenableStoreLink(url)).toBe(true);
    }
  });

  it("are labelled with the platform names", () => {
    expect(INVITE_STORE_LINKS.map((l) => l.label)).toEqual(["iPhone", "Android"]);
  });
});

describe("buildInviteMessage", () => {
  it("is the sentence, then each store link alone at the end of its own labelled line", () => {
    const text = buildInviteMessage("Join me on YuKon3t:");
    expect(text).toBe(`Join me on YuKon3t:\n${LINES}`);
    expect(text.split("\n")).toEqual(["Join me on YuKon3t:", `iPhone: ${APP}`, `Android: ${PLAY}`]);
    expect(text.endsWith(PLAY)).toBe(true);
  });

  it("has the same shape in every language", () => {
    for (const t of [inviteEn, inviteEs, inviteFr, invitePt, inviteAr, inviteDe, inviteIt, inviteHi, inviteSw]) {
      const text = buildInviteMessage(t.message);
      const lines = text.split("\n");
      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe(t.message.trim());
      expect(lines[1]).toBe(`iPhone: ${APP}`);
      expect(lines[2]).toBe(`Android: ${PLAY}`);
    }
  });

  it("is just the two links with no sentence", () => {
    expect(buildInviteMessage("  ")).toBe(LINES);
  });

  it("no longer carries the web sign-up link", () => {
    for (const t of [inviteEn, inviteEs, inviteFr, invitePt, inviteAr, inviteDe, inviteIt, inviteHi, inviteSw]) {
      expect(buildInviteMessage(t.message)).not.toContain("yukon3t.com");
      expect(t.message).not.toContain("sign-up");
    }
    const source = readFileSync("src/lib/invite-link.ts", "utf8");
    expect(source).not.toContain("https://yukon3t.com/sign-up");
    expect(source).not.toContain("/sign-up");
    const panel = readFileSync("src/components/invite-panel.tsx", "utf8");
    expect(panel).not.toContain("sign-up");
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
    expect(decodeURIComponent(body)).toContain(PLAY);
    expect(decodeURIComponent(body)).toContain(APP);
    // The "?" and "=" inside the Play URL are encoded, so they can't end the body or start a new parameter.
    expect(body).not.toContain("?");
    expect(body).not.toContain("=");
    expect(new URLSearchParams(href.slice(href.indexOf("?") + 1)).get("body")).toBe(message);
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
    expect(href.searchParams.get("text")?.endsWith(PLAY)).toBe(true);
  });

  it("opens WhatsApp's picker without a usable number", () => {
    for (const tel of [null, undefined, "", "72345"]) {
      const href = new URL(buildWhatsAppInviteHref(message, tel));
      expect(href.pathname).toBe("/");
      expect(href.searchParams.get("text")).toBe(message);
    }
  });
});
