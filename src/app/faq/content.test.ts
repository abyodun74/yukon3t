import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { FAQ_CONTENT } from "./content";
import { FAQ_IDS, FAQ_SECTION_IDS } from "./ids";
import { FAQ_MARKUP, answerLinks } from "./markup";
import { PRIVATE_AVATARS_NOTE } from "./content/private-avatars";

// The English FAQ is JSX in page.tsx, which a node test can't import (it reads the session). Its ids are read from
// the source instead: every `id: "…"` in the `sections` array, in order, sections first.
const pageSource = readFileSync(path.resolve(import.meta.dirname, "page.tsx"), "utf8");
const sectionsSource = pageSource.slice(pageSource.indexOf("const sections"), pageSource.indexOf("export default"));
const englishSectionIds = [...sectionsSource.matchAll(/^ {4}id: "([^"]+)",$/gm)].map((m) => m[1]);
const englishItemIds = [...sectionsSource.matchAll(/^ {8}id: "([^"]+)",$/gm)].map((m) => m[1]);
const englishLinks = [...sectionsSource.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]).sort();

const LANGUAGES = Object.keys(FAQ_CONTENT) as Array<keyof typeof FAQ_CONTENT>;

describe("FAQ ids", () => {
  it("lists exactly the sections and entries of the English page, in order", () => {
    expect(englishSectionIds).toEqual([...FAQ_SECTION_IDS]);
    expect(englishItemIds).toEqual([...FAQ_IDS]);
  });

  it("has no duplicates, and every id works as an anchor", () => {
    expect(new Set(FAQ_IDS).size).toBe(FAQ_IDS.length);
    for (const id of FAQ_IDS) expect(id, id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe.each(LANGUAGES)("FAQ in %s", (language) => {
  const content = FAQ_CONTENT[language];

  it("has every section and every entry, and nothing else", () => {
    expect(Object.keys(content.sections).sort()).toEqual([...FAQ_SECTION_IDS].sort());
    expect(Object.keys(content.items).sort()).toEqual([...FAQ_IDS].sort());
  });

  it("has no empty text", () => {
    expect(content.heading.trim()).not.toBe("");
    expect(content.intro.trim()).not.toBe("");
    for (const id of FAQ_SECTION_IDS) expect(content.sections[id].trim(), id).not.toBe("");
    for (const id of FAQ_IDS) {
      expect(content.items[id].q.trim(), id).not.toBe("");
      expect(content.items[id].a.trim(), id).not.toBe("");
    }
  });

  it("uses only markup the page can draw", () => {
    for (const id of FAQ_IDS) {
      const { q, a } = content.items[id];
      // Questions are plain text.
      expect(q, id).not.toMatch(/[*`[\]]|\n/);
      // What is left once every well-formed token is taken out must hold no stray marker: an unclosed ** or `, a
      // link whose target isn't an internal path.
      const rest = a.replace(FAQ_MARKUP, "");
      expect(rest, id).not.toMatch(/[*`]|\]\(|\[[^\]]*\]/);
      // Paragraphs are separated by exactly one blank line: no other line break survives the split.
      for (const paragraph of a.split("\n\n")) expect(paragraph, id).not.toContain("\n");
    }
  });

  it("links to the same pages as the English", () => {
    const links = FAQ_IDS.flatMap((id) => answerLinks(content.items[id].a)).sort();
    expect(links).toEqual(englishLinks);
  });

  it("keeps the product names", () => {
    const all = FAQ_IDS.map((id) => `${content.items[id].q} ${content.items[id].a}`).join(" ");
    for (const name of ["YuKon3t", "Circles", "Collab Boards", "Muse", "Ambient", "Inner Circle"]) expect(all).toContain(name);
  });

  it("keeps every number the English answer about view-once media and hidden chats states", () => {
    // The figures these answers promise. A translation that drops or changes one is wrong whatever else it says.
    const figures: Array<[(typeof FAQ_IDS)[number], string[]]> = [
      ["send-photo-video-disappears-after", ["64", "14"]],
      ["hiding-chat", ["4", "8"]],
      ["open-hidden-chat-unhide-one", ["10"]],
      ["forgot-pin-happens-hidden-chats", ["5", "15"]],
      ["add-more-people-call", ["8"]],
      ["there-limit-long-call-last", ["12"]],
      ["says-account-locked-happened", ["4", "24"]],
      ["who-join-yukon3t", ["16", "17"]],
      ["ambient-2", ["8", "48"]],
      ["did-live-stream-end-its", ["30"]],
      ["difference-between-watching-joining-guest", ["3"]],
      ["which-video-formats-upload-everyone", ["2"]],
      ["need-sign-up", ["3", "20"]],
      ["pick-category-circle", ["5"]],
    ];
    for (const [id, numbers] of figures) {
      const found = content.items[id].a.match(/\d+/g) ?? [];
      for (const number of numbers) expect(found, `${id}: ${number}`).toContain(number);
    }
  });
});

describe("private profile pictures note", () => {
  it("exists in every language, as plain text the page can draw", () => {
    for (const language of ["en", ...LANGUAGES] as const) {
      const note = PRIVATE_AVATARS_NOTE[language];
      expect(note.trim(), language).not.toBe("");
      expect(note, language).not.toMatch(/[*`[\]]|\n/);
    }
  });

  it("is attached to the profile-picture entry", () => {
    const entry = sectionsSource.slice(sectionsSource.indexOf('id: "save-someones-profile-picture"'));
    expect(entry.slice(0, entry.indexOf("a: ("))).toContain("privateAvatarsNote: true");
  });
});
