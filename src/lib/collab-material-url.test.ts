import { describe, expect, it } from "vitest";
import { isCollabMaterialContentType, isCollabMaterialUrl } from "@/lib/collab-material-url";

// Audit L6 (2026-10-29): a shared material from a call app-message must be one of our own collab-material uploads.

const BASE = "https://media.example.com";

describe("isCollabMaterialUrl", () => {
  it("accepts our own collab-material objects", () => {
    expect(isCollabMaterialUrl(`${BASE}/collab-material/cuser/abc.pdf`, BASE)).toBe(true);
    expect(isCollabMaterialUrl(`${BASE}/collab-material/cuser/abc.pdf`, `${BASE}/`)).toBe(true);
  });

  it("refuses everything else", () => {
    for (const url of [
      "https://evil.example/collab-material/cuser/abc.pdf",
      "http://media.example.com/collab-material/cuser/abc.pdf",
      `${BASE}/post-image/cuser/abc.jpg`,
      `${BASE}/collab-material/abc.pdf`,
      `${BASE}/collab-material/cuser/x/abc.pdf`,
      `${BASE}/collab-material/cuser/abc.pdf?x=1`,
      "https://user:pw@media.example.com/collab-material/cuser/abc.pdf",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(isCollabMaterialUrl(url, BASE)).toBe(false);
    }
  });

  it("refuses everything when the media base isn't configured", () => {
    expect(isCollabMaterialUrl(`${BASE}/collab-material/cuser/abc.pdf`, null)).toBe(false);
  });

  it("allows only the collab-material content types", () => {
    expect(isCollabMaterialContentType("application/pdf")).toBe(true);
    expect(isCollabMaterialContentType("text/html")).toBe(false);
    expect(isCollabMaterialContentType("image/svg+xml")).toBe(false);
  });
});
