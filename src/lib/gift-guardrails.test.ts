import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { SUPPORTED_LOCALES } from "@/lib/i18n/locales";

// The Gift Universe's hard guardrails, enforced on the source: no countdowns, scarcity or rankings in any gift wording;
// no religion field anywhere; occasions never notify; nothing random about what a gift gives.

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (value && typeof value === "object") for (const v of Object.values(value)) strings(v, out);
  return out;
}

// Countdowns, "only N left", "hurry", "last chance", "limited time", sold-out pressure and leaderboards, in all five
// languages.
const PRESSURE = [
  /\bonly\s+\{?\w*\}?\s*left\b/i,
  /\b\d+\s+left\b/i,
  /\bhurry\b/i,
  /\blast chance\b/i,
  /\blimited time\b/i,
  /\bends in\b/i,
  /\bcountdown\b/i,
  /\bselling (out|fast)\b/i,
  /\bleaderboard\b/i,
  /\btop (sender|gifter|supporter)s?\b/i,
  /\bgone (forever|for good)\b/i,
  /solo quedan|date prisa|última oportunidad|tiempo limitado|cuenta regresiva/i,
  /plus que \d|dépêchez|dernière chance|durée limitée|compte à rebours/i,
  /restam apenas|corra|última chance|tempo limitado|contagem regressiva/i,
  /لم يتبق سوى|أسرع|الفرصة الأخيرة|لفترة محدودة|العد التنازلي/,
];

describe("gift wording", () => {
  it.each(SUPPORTED_LOCALES)("has no countdown, scarcity, urgency or ranking language in %s", (locale) => {
    const all = [...strings(DICTIONARIES[locale].gifts), ...strings(DICTIONARIES[locale].settings.gifts)];
    expect(all.length).toBeGreaterThan(50);
    for (const text of all) for (const pattern of PRESSURE) expect(text, `${locale}: ${text}`).not.toMatch(pattern);
  });

  it.each(SUPPORTED_LOCALES)("never names a religion or a religious festival in %s (Culture stays neutral)", (locale) => {
    const all = strings(DICTIONARIES[locale].gifts).join("\n");
    expect(all).not.toMatch(/christmas|easter|eid|ramadan|diwali|hanukkah|navidad|noël|natal|páscoa|pascua|عيد الفطر|رمضان|الميلاد المجيد/i);
  });
});

describe("no inference of religion", () => {
  it("has no religion field on a person (or a gift) and none in the occasion engine", () => {
    // (Post's feed category RELIGIOUS_SPIRITUAL is about a post's topic, set by a classifier, never about a person.)
    const schema = read("prisma/schema.prisma");
    for (const model of ["User", "GiftItem", "GiftProduct", "GiftSelfOccasion", "GiftShowcasePin", "OwnedGift", "GiftSend"]) {
      const start = schema.indexOf(`model ${model} {`);
      expect(start, model).toBeGreaterThan(-1);
      const body = schema.slice(start, schema.indexOf("\n}", start));
      expect(body, model).not.toMatch(/religio|faith|belief/i);
    }
    for (const file of ["src/lib/gift-occasions.ts", "src/lib/gift-occasions-data.ts"]) {
      expect(read(file), file).not.toMatch(/religio|faith|church|mosque|temple/i);
    }
  });
});

describe("occasions never notify", () => {
  it("the engine, its server half and the chip read only: no push, no FCM, no bell row, no realtime signal", () => {
    for (const file of ["src/lib/gift-occasions.ts", "src/lib/gift-occasions-data.ts", "src/components/gift-occasion-chip.tsx"]) {
      const src = read(file);
      expect(src, file).not.toMatch(/sendPush|sendFcm|notification\.create|notifyBadgeChange|publishEvent|@\/lib\/push\b|@\/lib\/fcm\b/);
      expect(src, file).not.toMatch(/\.(create|update|upsert|delete)(Many)?\(/);
    }
  });
});

describe("no randomized rewards", () => {
  it("nothing that decides what a gift gives or numbers uses randomness", () => {
    for (const file of ["src/lib/gift-delivery.ts", "src/lib/gifts.ts", "src/lib/gifts-data.ts", "src/lib/gift-occasions.ts"]) {
      expect(read(file), file).not.toMatch(/Math\.random|crypto\.random|randomInt|shuffle/);
    }
  });
});
