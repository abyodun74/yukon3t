import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inviteEn } from "@/lib/i18n/en/invite";
import { invite as inviteEs } from "@/lib/i18n/es/invite";
import { invite as inviteFr } from "@/lib/i18n/fr/invite";
import { invite as invitePt } from "@/lib/i18n/pt/invite";
import { invite as inviteAr } from "@/lib/i18n/ar/invite";

const ALL = { en: inviteEn, es: inviteEs, fr: inviteFr, pt: invitePt, ar: inviteAr };

describe("invite contact-row labels and hint", () => {
  for (const [lang, d] of Object.entries(ALL)) {
    it(`${lang} has non-empty Text / WhatsApp labels and the hint`, () => {
      expect(d.textButton.trim()).not.toBe("");
      expect(d.whatsApp.trim()).not.toBe("");
      expect(d.textHint.trim()).not.toBe("");
    });
  }

  it("English wording", () => {
    expect(inviteEn.textButton).toBe("Text");
    expect(inviteEn.textHint).toBe("If your phone asks how to open it, choose Messages.");
  });

  const src = readFileSync("src/components/invite-panel.tsx", "utf8");

  it("the panel renders both labels from the dictionary", () => {
    expect(src).toContain("{t.textButton}");
    expect(src).toContain("{t.whatsApp}");
    expect(src).not.toMatch(/>\s*(Text|WhatsApp)\s*</);
  });

  it("the hint is rendered once and gated on a non-iOS check", () => {
    expect(src.match(/t\.textHint/g)).toHaveLength(1);
    expect(src).toMatch(/detectPickerPlatform\(\)\s*!==\s*"ios"\s*&&\s*\(\s*<p[^>]*>\{t\.textHint\}/);
  });
});
