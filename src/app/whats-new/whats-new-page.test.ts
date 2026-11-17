import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// /whats-new shows each announcement in the reader's language when the admin posted that version, else the English
// base, and loads only the reader's language (no translation query at all for English).
let locale = "es";
const findMany = vi.fn();

vi.mock("@/lib/page-guards", () => ({ getSessionUserOrRedirect: async () => ({ id: "u1" }) }));
vi.mock("@/lib/i18n/server", () => ({
  getLocale: async () => locale,
  getDictionary: async () => ({ pages: { whatsNew: { title: "What's new", intro: "Intro", empty: "Nothing yet" } } }),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { announcement: { findMany: (...a: unknown[]) => findMany(...a) } } }));
vi.mock("@/components/back-button", () => ({ BackButton: () => null }));
vi.mock("@/components/whats-new-seen-marker", () => ({ WhatsNewSeenMarker: () => null }));

import WhatsNewPage from "./page";

const createdAt = new Date("2026-11-10T12:00:00Z");
const translated = {
  id: "a1",
  title: "New: polls",
  body: "Add a poll to any post.",
  createdAt,
  mediaType: null,
  mediaUrl: null,
  mediaThumbnailUrl: null,
};
const englishOnly = { ...translated, id: "a2", title: "Faster uploads", body: "Uploads retry by themselves." };

beforeEach(() => {
  findMany.mockReset();
  findMany.mockImplementation(async (args: { include?: { translations: { where: { locale: string } } } }) => {
    const wanted = args.include?.translations.where.locale;
    const rows = wanted === "es" ? [{ locale: "es", title: "Nuevo: encuestas", body: "Añade una encuesta." }] : [];
    return [
      args.include ? { ...translated, translations: rows } : translated,
      args.include ? { ...englishOnly, translations: [] } : englishOnly,
    ];
  });
});

async function render() {
  return renderToStaticMarkup(await WhatsNewPage());
}

describe("What's new page", () => {
  it("renders the reader's language where a version exists and the English base elsewhere", async () => {
    locale = "es";
    const html = await render();
    expect(findMany.mock.calls[0][0].include).toEqual({
      translations: { where: { locale: "es" }, select: { locale: true, title: true, body: true } },
    });
    expect(html).toContain("Nuevo: encuestas");
    expect(html).toContain("Añade una encuesta.");
    expect(html).not.toContain("New: polls");
    // No Spanish version: the English is shown, marked as English.
    expect(html).toContain("Faster uploads");
    expect(html).toMatch(/<div lang="en"><h2[^>]*>Faster uploads/);
    expect(html).toMatch(/<div lang="es"><h2[^>]*>Nuevo: encuestas/);
  });

  it("falls back to English for a language with no versions", async () => {
    locale = "fr";
    const html = await render();
    expect(html).toContain("New: polls");
    expect(html).toContain("Faster uploads");
  });

  it("loads no translations for an English reader", async () => {
    locale = "en";
    const html = await render();
    expect(findMany.mock.calls[0][0].include).toBeUndefined();
    expect(html).toContain("New: polls");
  });
});
