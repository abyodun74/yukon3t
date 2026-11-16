import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import Link from "next/link";
import { collabShareMessage, collabShareUrl, isCollabShareable } from "@/lib/collab-share";
import { APP_LINK_EXCLUDED_PATTERNS, appleAppSiteAssociation, classifyLink, inAppPathFor, openedUrlTarget } from "@/lib/app-links";
import { linkifyText } from "@/lib/linkify";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("collab share rules", () => {
  it("shares PUBLIC, OPEN collabs only (private is invite-only; closed is ended or removed by moderation)", () => {
    expect(isCollabShareable({ visibility: "PUBLIC", status: "OPEN" })).toBe(true);
    expect(isCollabShareable({ visibility: "PRIVATE", status: "OPEN" })).toBe(false);
    expect(isCollabShareable({ visibility: "PUBLIC", status: "CLOSED" })).toBe(false);
    expect(isCollabShareable({ visibility: "PRIVATE", status: "CLOSED" })).toBe(false);
  });

  it("always links the canonical production host", () => {
    expect(collabShareUrl("cabc123")).toBe("https://yukon3t.com/collab/cabc123");
    expect(collabShareUrl("a b/c")).toBe("https://yukon3t.com/collab/a%20b%2Fc");
  });

  it("writes the title and the link on its own line, nothing else", () => {
    expect(collabShareMessage({ title: "  Spanish\n  exchange ", id: "cabc" })).toBe(
      "Spanish exchange\nhttps://yukon3t.com/collab/cabc",
    );
    expect(collabShareMessage({ title: "   ", id: "x" })).toBe("https://yukon3t.com/collab/x");
  });

  it("the collab link builders never take the host from the page", () => {
    for (const file of [
      "src/lib/collab-share.ts",
      "src/components/collab-share-sheet.tsx",
      "src/components/collab-long-press.tsx",
      "src/components/share-link-sheet.tsx",
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(/location\.origin/);
      expect(source, file).not.toMatch(/location\.host\b/);
    }
    expect(read("src/lib/collab-share.ts")).toContain("${CANONICAL_ORIGIN}/collab/");
  });
});

describe("a shared collab link opens inside the app", () => {
  it("is an in-app link to /collab/<id>, www and query included", () => {
    expect(classifyLink("https://yukon3t.com/collab/abc")).toEqual({ kind: "internal", path: "/collab/abc" });
    expect(classifyLink("https://www.yukon3t.com/collab/abc#polls")).toEqual({ kind: "internal", path: "/collab/abc#polls" });
    expect(inAppPathFor("https://yukon3t.com/collab/abc")).toBe("/collab/abc");
    expect(inAppPathFor(collabShareUrl("cabc123"))).toBe("/collab/cabc123");
  });

  it("linkify renders it in a chat message as an in-app next/link, not a new-window link", () => {
    const nodes = linkifyText(collabShareMessage({ title: "Spanish exchange", id: "abc" }));
    expect(nodes[0]).toBe("Spanish exchange\n");
    const link = nodes[1] as { type: unknown; props: Record<string, unknown> };
    expect(link.type).toBe(Link);
    expect(link.props.href).toBe("/collab/abc");
    expect(link.props.target).toBeUndefined();
  });

  it("a collab link that opened the native app (universal link / App Link) routes to the collab in place", () => {
    expect(openedUrlTarget("https://yukon3t.com/collab/abc")).toEqual({
      path: "/collab/abc",
      documentLoad: false,
      fromNotification: false,
    });
  });

  it("the apple-app-site-association claims /collab/* for the app (not excluded)", () => {
    for (const pattern of APP_LINK_EXCLUDED_PATTERNS) {
      expect(pattern.startsWith("/collab")).toBe(false);
    }
    // First matching component wins, as on iOS.
    const glob = (pattern: string) =>
      new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    const [detail] = appleAppSiteAssociation().applinks.details;
    for (const path of ["/collab/abc", "/collab/cabc123", "/collab"]) {
      const match = detail.components.find((c) => glob(c["/"]).test(path));
      expect(match, path).toBeDefined();
      expect(match?.exclude, path).toBeUndefined();
    }
  });
});
