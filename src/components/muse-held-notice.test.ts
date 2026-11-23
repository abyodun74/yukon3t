import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { SUPPORTED_LOCALES } from "@/lib/i18n/locales";

const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, file), "utf8");

describe("held (FLAGGED) Muse notice", () => {
  it("is worded in every locale, in the composer, share-target and share sheet dictionaries", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const d = DICTIONARIES[locale] as unknown as Record<string, Record<string, Record<string, Record<string, string>>>>;
      for (const text of [d.muse.composer.held, d.shell.shareTarget.museHeld, d.feed.share.sharedToMuseHeld]) {
        expect(typeof text, locale).toBe("string");
        expect(text.length, locale).toBeGreaterThan(10);
      }
    }
  });

  it("composer shows the notice and does not navigate away when createMuse reports held", () => {
    const src = read("muse-composer.tsx");
    const held = src.slice(src.indexOf('"held" in result'));
    expect(held.indexOf("setHeldNotice(true)")).toBeGreaterThan(-1);
    expect(held.indexOf("return;")).toBeLessThan(held.indexOf('router.push("/muse")'));
    expect(src).toContain("t.held");
  });

  it("share-target gate shows the Muse notice and stays open before navigating", () => {
    const src = read("share-target-gate.tsx");
    const i = src.indexOf('setHeldNotice("muse")');
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(i, src.indexOf('router.push("/muse")', i))).toContain("return;");
    expect(src).toContain("t.shareTarget.museHeld");
  });

  it("share sheet words a held shareToMuse", () => {
    expect(read("share-modal.tsx")).toContain("t.share.sharedToMuseHeld");
    expect(read("../app/actions/shares.ts")).toContain("held: true as const");
  });
});
