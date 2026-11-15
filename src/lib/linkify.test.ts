import { describe, expect, it } from "vitest";
import Link from "next/link";
import { linkifyText } from "./linkify";

// React elements are plain objects ({ type, props, ... }) even without a
// DOM/renderer — inspecting their shape directly keeps this test in the
// "node" environment vitest.config.mts already uses, no jsdom/RTL needed.
type ElementShape = { type: unknown; props: Record<string, unknown> };
function asElement(node: unknown): ElementShape | null {
  if (typeof node !== "object" || node === null || !("type" in node) || !("props" in node)) return null;
  return node as ElementShape;
}

function isLinkTo(node: unknown, href: string): boolean {
  const el = asElement(node);
  return el !== null && el.type === "a" && el.props.href === href;
}

describe("linkifyText", () => {
  it("returns plain text unchanged when there's no link", () => {
    expect(linkifyText("just some text")).toEqual(["just some text"]);
  });

  it("turns a bare URL into a link element", () => {
    const result = linkifyText("https://example.com/reel/123");
    expect(result).toHaveLength(1);
    expect(isLinkTo(result[0], "https://example.com/reel/123")).toBe(true);
  });

  it("splits caption text around an embedded link, keeping both", () => {
    const result = linkifyText("Check this out! https://example.com/x and more");
    expect(result[0]).toBe("Check this out! ");
    expect(isLinkTo(result[1], "https://example.com/x")).toBe(true);
    expect(result[2]).toBe(" and more");
  });

  it("linkifies more than one URL in the same text", () => {
    const result = linkifyText("https://a.com then https://b.com");
    const links = result.filter((n) => isLinkTo(n, "https://a.com") || isLinkTo(n, "https://b.com"));
    expect(links).toHaveLength(2);
  });

  it("opens another site outside the app (new tab / system browser)", () => {
    const el = asElement(linkifyText("https://example.com/x")[0]);
    expect(el?.props.target).toBe("_blank");
    expect(el?.props.rel).toBe("noopener noreferrer");
  });

  it("turns a yukon3t.com link into an in-app link to its path, with no new window", () => {
    for (const [typed, path] of [
      ["https://yukon3t.com/post/abc", "/post/abc"],
      ["https://www.yukon3t.com/u/123?story=9#top", "/u/123?story=9#top"],
      ["http://yukon3t.com/circles/runners", "/circles/runners"],
    ]) {
      const el = asElement(linkifyText(typed)[0]);
      expect(el?.type).toBe(Link);
      expect(el?.props.href).toBe(path);
      expect(el?.props.target).toBeUndefined();
      expect(el?.props.children).toBe(typed);
    }
  });

  it("keeps a preview / lookalike host external", () => {
    for (const typed of ["https://yukon3t.netlify.app/post/1", "https://yukon3t.com.evil.example/post/1"]) {
      expect(isLinkTo(linkifyText(typed)[0], typed)).toBe(true);
    }
  });
});
