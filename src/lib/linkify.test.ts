import { describe, expect, it } from "vitest";
import { linkifyText } from "./linkify";

// React elements are plain objects ({ type, props, ... }) even without a
// DOM/renderer — inspecting their shape directly keeps this test in the
// "node" environment vitest.config.mts already uses, no jsdom/RTL needed.
function isLinkTo(node: unknown, href: string): boolean {
  return (
    typeof node === "object" &&
    node !== null &&
    "type" in node &&
    node.type === "a" &&
    "props" in node &&
    typeof node.props === "object" &&
    node.props !== null &&
    "href" in node.props &&
    node.props.href === href
  );
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
});
