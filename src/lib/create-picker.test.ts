import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CREATE_FLOW_CLOSED,
  CREATE_PICKER_HANDOFF_MAX_MS,
  CREATE_PICKER_KINDS,
  PROFILE_COMPOSER_ID,
  createFlowOnScreen,
  createFlowReducer,
  createFlowView,
  feedComposeHref,
  type CreateFlowEvent,
  type CreateFlowState,
} from "./create-picker";
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

describe("create picker -> composer hand-off", () => {
  const run = (events: CreateFlowEvent[], from: CreateFlowState = CREATE_FLOW_CLOSED) =>
    events.reduce<CreateFlowState[]>((states, e) => [...states, createFlowReducer(states[states.length - 1], e)], [from]);

  it("closes the picker first, then opens the Story composer once it has left", () => {
    const states = run([{ type: "open" }, { type: "choose", kind: "story" }, { type: "pickerExited" }]);
    expect(states.map(createFlowOnScreen)).toEqual([null, "picker", "picker-leaving", "story"]);
    expect(createFlowView(states[2])).toEqual({ pickerOpen: false, composer: null });
    expect(createFlowView(states[3])).toEqual({ pickerOpen: false, composer: "story" });
  });

  it("opens the composer after the backstop timeout if the exit never reports", () => {
    const states = run([{ type: "open" }, { type: "choose", kind: "muse" }, { type: "handoffTimeout" }]);
    expect(createFlowView(states[3])).toEqual({ pickerOpen: false, composer: "muse" });
    expect(CREATE_PICKER_HANDOFF_MAX_MS).toBeGreaterThan(300); // the bottom sheet's 0.3s exit tween
    expect(CREATE_PICKER_HANDOFF_MAX_MS).toBeLessThan(1000);
  });

  it("opens the composer once when both the exit and the timeout arrive", () => {
    const states = run([{ type: "open" }, { type: "choose", kind: "story" }, { type: "pickerExited" }, { type: "handoffTimeout" }]);
    expect(states[3]).toBe(states[4]);
  });

  it("is never both open and never neither while switching, from any sequence of events", () => {
    const events: CreateFlowEvent[] = [
      { type: "open" },
      { type: "dismiss" },
      { type: "choose", kind: "story" },
      { type: "choose", kind: "muse" },
      { type: "choose", kind: "feed" },
      { type: "pickerExited" },
      { type: "handoffTimeout" },
      { type: "composerClosed" },
    ];
    // Every sequence of up to 5 events.
    let frontier: CreateFlowState[] = [CREATE_FLOW_CLOSED];
    for (let depth = 0; depth < 5; depth++) {
      const next: CreateFlowState[] = [];
      for (const state of frontier) {
        for (const event of events) {
          const after = createFlowReducer(state, event);
          const view = createFlowView(after);
          expect(view.pickerOpen && view.composer !== null).toBe(false);
          // Leaving the picker for a composer always passes through the picker still on screen (leaving), never a
          // blank frame and never straight to the composer.
          if (state.phase === "picker" && after.phase !== "picker") {
            expect(after.phase === "handoff" || after.phase === "closed").toBe(true);
          }
          if (after.phase === "composer") expect(state.phase === "handoff" || state.phase === "composer").toBe(true);
          next.push(after);
        }
      }
      frontier = next;
    }
  });

  it("closes outright for Feed post and on dismiss, and ignores stray events", () => {
    expect(run([{ type: "open" }, { type: "choose", kind: "feed" }]).at(-1)).toEqual(CREATE_FLOW_CLOSED);
    expect(run([{ type: "open" }, { type: "dismiss" }]).at(-1)).toEqual(CREATE_FLOW_CLOSED);
    const composer: CreateFlowState = { phase: "composer", kind: "story" };
    expect(createFlowReducer(composer, { type: "open" })).toBe(composer);
    expect(createFlowReducer(composer, { type: "choose", kind: "muse" })).toBe(composer);
    expect(createFlowReducer(composer, { type: "composerClosed" })).toEqual(CREATE_FLOW_CLOSED);
    expect(createFlowReducer(CREATE_FLOW_CLOSED, { type: "pickerExited" })).toBe(CREATE_FLOW_CLOSED);
  });

  it("is what CreatePickerButton renders from, with the picker's exit driving the hand-off", () => {
    const source = src("components/create-picker-sheet.tsx");
    expect(source).toMatch(/useReducer\(createFlowReducer, CREATE_FLOW_CLOSED\)/);
    expect(source).toMatch(/onExitComplete=\{\(\) => dispatch\(\{ type: "pickerExited" \}\)\}/);
    expect(source).toMatch(/dispatch\(\{ type: "handoffTimeout" \}\), CREATE_PICKER_HANDOFF_MAX_MS/);
    expect(source).toMatch(/<StoryUploadModal open=\{composer === "story"\}/);
    expect(source).not.toMatch(/useState/);
  });
});
