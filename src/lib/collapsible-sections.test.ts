import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccordionIndicator } from "@/components/accordion";
import { CollapsibleSection } from "@/components/collapsible-section";
import {
  fragmentTargetId,
  openSectionsStorageKey,
  parseOpenSections,
  samePageFragmentTarget,
  withSectionOpen,
} from "./collapsible-sections";

describe("parseOpenSections", () => {
  it("reads a stored list of ids", () => {
    expect(parseOpenSections(JSON.stringify(["privacy", "calls"]))).toEqual(["privacy", "calls"]);
  });

  it("treats anything unreadable as nothing open", () => {
    expect(parseOpenSections(null)).toEqual([]);
    expect(parseOpenSections(undefined)).toEqual([]);
    expect(parseOpenSections("")).toEqual([]);
    expect(parseOpenSections("{not json")).toEqual([]);
    expect(parseOpenSections(JSON.stringify({ privacy: true }))).toEqual([]);
    expect(parseOpenSections(JSON.stringify("privacy"))).toEqual([]);
  });

  it("drops non-strings, empty and overlong ids and duplicates", () => {
    expect(parseOpenSections(JSON.stringify(["a", 1, "", null, "a", "x".repeat(101), "b"]))).toEqual(["a", "b"]);
  });

  it("caps how many ids it keeps", () => {
    const many = Array.from({ length: 80 }, (_, i) => `s${i}`);
    expect(parseOpenSections(JSON.stringify(many))).toHaveLength(50);
  });
});

describe("withSectionOpen", () => {
  it("adds an opened section once and removes a closed one", () => {
    expect(withSectionOpen([], "privacy", true)).toEqual(["privacy"]);
    expect(withSectionOpen(["privacy"], "privacy", true)).toEqual(["privacy"]);
    expect(withSectionOpen(["privacy", "calls"], "privacy", false)).toEqual(["calls"]);
    expect(withSectionOpen(["calls"], "privacy", false)).toEqual(["calls"]);
  });

  it("doesn't change the list it was given", () => {
    const ids = ["calls"];
    withSectionOpen(ids, "privacy", true);
    expect(ids).toEqual(["calls"]);
  });
});

describe("fragmentTargetId", () => {
  it("names the element a fragment points at", () => {
    expect(fragmentTargetId("#birthdays")).toBe("birthdays");
    expect(fragmentTargetId("sign-in-method")).toBe("sign-in-method");
    expect(fragmentTargetId("#caf%C3%A9")).toBe("café");
  });

  it("is null for an empty or malformed fragment", () => {
    expect(fragmentTargetId("")).toBeNull();
    expect(fragmentTargetId("#")).toBeNull();
    expect(fragmentTargetId(null)).toBeNull();
    expect(fragmentTargetId("#%E0%A4%A")).toBeNull();
  });
});

describe("samePageFragmentTarget", () => {
  const here = "https://yukon3t.com/settings?saved=1";

  it("returns the target of a link to a fragment on this page", () => {
    expect(samePageFragmentTarget("#sign-in-method", here)).toBe("sign-in-method");
    expect(samePageFragmentTarget("/settings#birthdays", here)).toBe("birthdays");
    expect(samePageFragmentTarget("https://yukon3t.com/settings#notifications", here)).toBe("notifications");
  });

  it("ignores links to other pages, other sites and links without a fragment", () => {
    expect(samePageFragmentTarget("/faq#birthday-reminders", here)).toBeNull();
    expect(samePageFragmentTarget("https://example.com/settings#privacy", here)).toBeNull();
    expect(samePageFragmentTarget("/settings", here)).toBeNull();
    expect(samePageFragmentTarget("/settings/ambient", here)).toBeNull();
  });
});

describe("openSectionsStorageKey", () => {
  it("is per page", () => {
    expect(openSectionsStorageKey("settings")).not.toBe(openSectionsStorageKey("other"));
  });
});

describe("AccordionIndicator", () => {
  it("is decorative and shows + closed and − open, driven by the accordion group", () => {
    const html = renderToStaticMarkup(createElement(AccordionIndicator));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/group-open\/accordion:hidden group-aria-expanded\/accordion:hidden">\+</);
    expect(html).toMatch(/hidden group-open\/accordion:inline group-aria-expanded\/accordion:inline">−</);
    // No transition or animation: nothing to turn off for reduced motion.
    expect(html).not.toMatch(/transition|animate/);
  });
});

describe("CollapsibleSection (server render)", () => {
  const html = renderToStaticMarkup(
    createElement(
      CollapsibleSection,
      { id: "notifications", page: "settings", title: "Notifications" } as ComponentProps<typeof CollapsibleSection>,
      createElement("input", { name: "newMemberAlerts", type: "checkbox" }),
    ),
  );

  it("starts closed, like the FAQ's questions", () => {
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/<div id="notifications-panel"[^>]*hidden=""/);
  });

  it("is a heading holding a real button tied to its panel", () => {
    expect(html).toMatch(/<h2[^>]*><button type="button" id="notifications-toggle"/);
    expect(html).toContain('aria-controls="notifications-panel"');
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-labelledby="notifications-toggle"');
    // 44px tap target, and the accordion group the indicator follows.
    expect(html).toMatch(/<button[^>]*class="[^"]*group\/accordion[^"]*min-h-11/);
  });

  it("keeps its content mounted while closed, so forms and toggles keep their state", () => {
    expect(html).toContain('name="newMemberAlerts"');
  });

  it("carries the anchor id on the section", () => {
    expect(html).toMatch(/<section id="notifications"/);
  });
});

describe("Settings page sections", () => {
  const source = readFileSync(path.resolve(import.meta.dirname, "../app/settings/page.tsx"), "utf8");

  it("puts every section in a CollapsibleSection with a unique, stable anchor", () => {
    const ids = [...source.matchAll(/<CollapsibleSection id="([^"]+)" page="settings"/g)].map((m) => m[1]);
    expect(ids).toEqual(
      expect.arrayContaining([
        "privacy",
        "notifications",
        "language",
        "emoji-style",
        "data-saver",
        "ambient",
        "invite",
        "blocked",
        "calls",
        "sign-in-method",
        "phone",
        "your-data",
      ]),
    );
    expect(new Set(ids).size).toBe(ids.length);
    // No section left with the old, always-open heading.
    expect(source).not.toContain('<h2 className="text-lg font-semibold">');
  });

  it("keeps the in-page anchors it links to or is linked by", () => {
    expect(source).toContain('href="#sign-in-method"');
    expect(source).toContain('id="birthdays"');
  });

  it("titles sections from the dictionary, not hard-coded English", () => {
    for (const m of source.matchAll(/<CollapsibleSection [^>]*title=(\S+)>/g)) {
      expect(m[1]).toMatch(/^\{t\.[a-zA-Z]+\.heading\}$/);
    }
  });
});
