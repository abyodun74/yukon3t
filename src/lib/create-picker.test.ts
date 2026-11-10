import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CREATE_PICKER_KINDS, PROFILE_COMPOSER_ID, feedComposeHref } from "./create-picker";
import { feedEn } from "./i18n/en/feed";
import { feed as feedEs } from "./i18n/es/feed";
import { feed as feedFr } from "./i18n/fr/feed";
import { feed as feedPt } from "./i18n/pt/feed";
import { feed as feedAr } from "./i18n/ar/feed";

const src = (file: string) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");

describe("create picker", () => {
  it("offers Story, Feed post and Muse, in that order", () => {
    expect([...CREATE_PICKER_KINDS]).toEqual(["story", "feed", "muse"]);
  });

  it("sends Feed post to your own profile's composer", () => {
    expect(feedComposeHref("ck123")).toBe("/u/ck123?compose=1");
  });

  it("points at the composer id the profile page actually renders", () => {
    expect(src("app/u/[userId]/page.tsx")).toContain(`id="${PROFILE_COMPOSER_ID}"`);
  });

  it("has every label in all five languages", () => {
    for (const dict of [feedEn, feedEs, feedFr, feedPt, feedAr]) {
      for (const value of Object.values(dict.createPicker)) expect(value.trim()).not.toBe("");
    }
  });

  it("is what the + on your own picture opens, on Home and on your profile", () => {
    for (const file of ["components/story-tray.tsx", "components/profile-story-ring.tsx"]) {
      const source = src(file);
      expect(source, file).toContain("<CreatePickerButton");
      // The + no longer opens the story upload by itself.
      expect(source, file).not.toContain("addToStory");
    }
    expect(src("components/profile-story-ring.tsx")).not.toContain("StoryUploadModal");
  });
});
