import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The marketplace layout runs before its pages, so it must gate BEFORE the gifts dictionary is read or serialized:
// signed-out, non-admin and guest-preview visitors must receive no gift wording and no children.
const getSessionUserOrRedirect = vi.fn();
const getDictionary = vi.fn();
const getLocale = vi.fn();

class Redirect extends Error {}
class NotFound extends Error {}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound("notFound");
  },
}));
vi.mock("@/lib/page-guards", () => ({ getSessionUserOrRedirect: () => getSessionUserOrRedirect() }));
vi.mock("@/lib/i18n/server", () => ({ getDictionary: () => getDictionary(), getLocale: () => getLocale() }));
vi.mock("@/components/feed-layout", () => ({ FeedLayout: () => null }));
vi.mock("@/components/gifts-text", () => ({ GiftsTextProvider: () => null }));

import Layout from "./layout";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const listSourceFiles = (dir: string): string[] =>
  readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory()
      ? d.name === "generated"
        ? []
        : listSourceFiles(`${dir}/${d.name}`)
      : /\.tsx?$/.test(d.name)
        ? [`${dir}/${d.name}`]
        : [],
  );

// Walks the returned element tree for the props that would be serialized to the client.
function collectProps(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (node && typeof node === "object") {
    const el = node as { props?: Record<string, unknown> };
    if (el.props) {
      out.push(el.props);
      collectProps(el.props.children, out);
    }
  }
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  getLocale.mockResolvedValue("en");
  getDictionary.mockResolvedValue({ gifts: { title: "Gift marketplace" } });
});

describe("gift-marketplace layout gate", () => {
  it("redirects a signed-out visitor before any dictionary read", async () => {
    getSessionUserOrRedirect.mockRejectedValue(new Redirect("/sign-in"));
    await expect(Layout({ children: "child" })).rejects.toBeInstanceOf(Redirect);
    expect(getDictionary).not.toHaveBeenCalled();
    expect(getLocale).not.toHaveBeenCalled();
  });

  it.each([
    ["a signed-in non-admin", { id: "u", isAdmin: false }],
    ["the guest preview", { id: "g", isAdmin: false, isGuestPreview: true }],
    ["a guest-preview admin flag", { id: "g", isAdmin: true, isGuestPreview: true }],
  ])("404s %s before any dictionary read", async (_n, user) => {
    getSessionUserOrRedirect.mockResolvedValue(user);
    await expect(Layout({ children: "child" })).rejects.toBeInstanceOf(NotFound);
    expect(getDictionary).not.toHaveBeenCalled();
    expect(getLocale).not.toHaveBeenCalled();
  });

  it("renders children with the gifts dictionary for an admin", async () => {
    getSessionUserOrRedirect.mockResolvedValue({ id: "a", isAdmin: true });
    const tree = await Layout({ children: "child" });
    const props = collectProps(tree);
    expect(props.some((p) => (p.text as { title?: string } | undefined)?.title === "Gift marketplace")).toBe(true);
    expect(props.some((p) => p.children === "child")).toBe(true);
  });
});

describe("gift-marketplace structure", () => {
  it("the layout gates before it reads the dictionary", () => {
    const src = read("src/app/gift-marketplace/layout.tsx");
    expect(src.indexOf("requireGiftsUser()")).toBeGreaterThan(-1);
    expect(src.indexOf("requireGiftsUser()")).toBeLessThan(src.indexOf("getDictionary()"));
    expect(src.indexOf("requireGiftsUser()")).toBeLessThan(src.indexOf("getLocale()"));
  });

  it.each(["page.tsx", "[category]/page.tsx", "history/page.tsx"])("%s keeps its own gate", (f) => {
    expect(read(`src/app/gift-marketplace/${f}`)).toContain("requireGiftsUser()");
  });

  it("the shared gate checks sign-in and giftsEnabledFor with notFound", () => {
    const src = read("src/lib/gift-gate.ts");
    expect(src).toContain("getSessionUserOrRedirect");
    expect(src).toContain("giftsEnabledFor");
    expect(src).toContain("notFound()");
  });

  it("the preview effect code is pure presentation: no actions, DB, network or storage, and sound only via the gift sound modules", () => {
    const effectFiles = [
      "src/components/gift-stage.tsx",
      "src/components/gift-reveal.tsx",
      "src/lib/gift-effect-plan.ts",
      "src/components/gift-signature-motion.tsx",
      "src/lib/gift-signature-motion.ts",
    ];
    for (const f of effectFiles) {
      const src = read(f);
      expect(src, f).not.toMatch(/@\/app\/actions|prisma|fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|indexedDB|new Audio|AudioContext|\.play\(\)/);
    }
    for (const f of effectFiles.filter((f) => f !== "src/components/gift-reveal.tsx")) expect(read(f), f).not.toMatch(/gift-sound/);
  });

  it("the sound modules touch no actions, DB, network or storage (only the mute preference module uses storage)", () => {
    const soundFiles = ["src/lib/gift-sound-plan.ts", "src/lib/gift-sound-engine.ts", "src/lib/gift-sound.ts", "src/lib/use-gift-sound.ts"];
    for (const f of [...soundFiles, "src/lib/gift-sound-pref.ts"]) {
      const src = read(f);
      expect(src).not.toMatch(/@\/app\/actions|prisma|fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|https?:\/\/|new Audio|<audio|\.mp3|\.wav|\.ogg/);
      expect(src).not.toMatch(/sessionStorage|indexedDB|document\.cookie/);
    }
    for (const f of soundFiles) expect(read(f)).not.toMatch(/localStorage/);
    expect(read("src/lib/gift-sound-pref.ts")).toMatch(/localStorage/);
    // The plan is pure: no Web Audio, no DOM.
    expect(read("src/lib/gift-sound-plan.ts")).not.toMatch(/AudioContext|window\.|document\.|navigator\./);
  });

  it("the synth is a lazily loaded chunk: only a dynamic import or type imports reach it", () => {
    const controller = read("src/lib/gift-sound.ts");
    expect(controller).toContain('import("@/lib/gift-sound-engine")');
    expect(controller).toMatch(/import type \{[^}]*\} from "@\/lib\/gift-sound-engine"/);
    for (const f of listSourceFiles("src")) {
      if (f.endsWith(".test.ts") || f === "src/lib/gift-sound-engine.ts") continue;
      expect(read(f), f).not.toMatch(/^import (?!type)[^;]*from "@\/lib\/gift-sound-engine"/m);
    }
  });

  it("sound starts only from a tap: arming happens in the opening taps, starting only in the reveal's hook", () => {
    const armers = new Set<string>();
    const starters = new Set<string>();
    for (const f of listSourceFiles("src")) {
      if (f.endsWith(".test.ts")) continue;
      const src = read(f);
      if (/\barmGiftSound\(\)/.test(src)) armers.add(f);
      if (/\bstartGiftSound\(/.test(src)) starters.add(f);
    }
    expect([...armers].sort()).toEqual(
      [
        "src/components/gift-chat-card.tsx",
        "src/components/gift-history-view.tsx",
        "src/components/gift-marketplace.tsx",
        "src/components/profile-gifts.tsx",
        "src/lib/gift-sound.ts",
        "src/lib/use-gift-sound.ts",
      ].sort(),
    );
    expect([...starters].sort()).toEqual(["src/lib/gift-sound.ts", "src/lib/use-gift-sound.ts"]);
    // The reveal stops the sound the moment it starts closing, and offers an accessible mute toggle.
    const reveal = read("src/components/gift-reveal.tsx");
    expect(reveal).toContain("useGiftSound(");
    expect(reveal).toMatch(/stopSound\(\);\s*\n\s*thenRef\.current = then/);
    expect(reveal).toContain("aria-pressed={sound.muted}");
    expect(reveal).toContain("aria-label={t.sound.mute}");
  });

  it("the marketplace calls no server action but favorites and the checkout path", () => {
    const src = read("src/components/gift-marketplace.tsx");
    expect(src.match(/from "@\/app\/actions\/[^"]+"/g)).toEqual(['from "@/app/actions/gift-market"']);
    expect(src).toContain("setGiftFavorite");
    expect(src).not.toMatch(/createGiftIntent|purchase|notify/i);
  });

  it("the preview is the shared reveal with a labelled sample sender, never a real person's name or note", () => {
    const src = read("src/components/gift-marketplace.tsx");
    expect(src).toContain("<GiftReveal");
    expect(src).toContain('mode="preview"');
    expect(src).toContain('sender="sample"');
    expect(src).toContain("message={m.preview.sampleMessage}");
    expect(src).not.toMatch(/senderName|senderUsername|OpenedGift/);
  });

  it("the recipient's open screen is the same reveal, and only ever calls the existing Thank You action", () => {
    const src = read("src/components/gift-open-overlay.tsx");
    expect(src).toContain("<GiftReveal");
    expect(src).toContain('mode="recipient"');
    expect(src.match(/from "@\/app\/actions\/[^"]+"/g)).toEqual(['from "@/app/actions/gifts"']);
    expect(src).toMatch(/import \{ sendThankYouGift, type OpenedGift \} from "@\/app\/actions\/gifts"/);
    // Offered only while openGift says the recipient still can.
    expect(src).toContain("gift.canThank");
  });

  it("no other gift-marketplace file reads the gifts dictionary", () => {
    for (const f of ["page.tsx", "[category]/page.tsx", "history/page.tsx", "loading.tsx"]) {
      expect(read(`src/app/gift-marketplace/${f}`)).not.toMatch(/getDictionary|GiftsTextProvider|\bt\.gifts\b/);
    }
  });
});
