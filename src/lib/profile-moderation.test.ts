import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { profileTextToModerate } from "@/lib/profile-moderation";

// Audit M5 (2026-10-29): display names and live-stream titles go through the text moderation gate.

describe("profileTextToModerate", () => {
  it("checks a new or changed name together with the bio", () => {
    expect(profileTextToModerate("New Name", null, "my bio")).toBe("New Name\nmy bio");
    expect(profileTextToModerate("New Name", "Old Name", "")).toBe("New Name");
  });

  it("doesn't re-check an unchanged name", () => {
    expect(profileTextToModerate("Same", "Same", "bio")).toBe("bio");
    expect(profileTextToModerate(" Same ", "Same", null)).toBe("");
  });
});

describe("wiring (source scan)", () => {
  it("onboarding and profile edits moderate the name", () => {
    const src = readFileSync("src/app/actions/profile.ts", "utf8");
    expect(src.match(/profileTextToModerate\(name, user\.name, bio\)/g)?.length).toBe(2);
  });
  it("starting a live stream moderates its title", () => {
    expect(readFileSync("src/app/actions/live-streams.ts", "utf8")).toContain("await moderateText(title)");
  });
});
