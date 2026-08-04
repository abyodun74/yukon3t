import { describe, it, expect } from "vitest";
import { parseVideoEmbedUrl, embedSrc } from "@/lib/video-embed";

describe("parseVideoEmbedUrl", () => {
  it("parses a standard YouTube watch URL", () => {
    expect(parseVideoEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
      provider: "YOUTUBE",
      id: "dQw4w9WgXcQ",
    });
  });

  it("parses youtu.be, /embed/, and /shorts/ forms", () => {
    expect(parseVideoEmbedUrl("https://youtu.be/dQw4w9WgXcQ")).toEqual({
      provider: "YOUTUBE",
      id: "dQw4w9WgXcQ",
    });
    expect(parseVideoEmbedUrl("https://youtube.com/embed/dQw4w9WgXcQ")).toEqual({
      provider: "YOUTUBE",
      id: "dQw4w9WgXcQ",
    });
    expect(parseVideoEmbedUrl("https://m.youtube.com/shorts/dQw4w9WgXcQ")).toEqual({
      provider: "YOUTUBE",
      id: "dQw4w9WgXcQ",
    });
  });

  it("parses vimeo.com and player.vimeo.com URLs", () => {
    expect(parseVideoEmbedUrl("https://vimeo.com/76979871")).toEqual({
      provider: "VIMEO",
      id: "76979871",
    });
    expect(parseVideoEmbedUrl("https://player.vimeo.com/video/76979871")).toEqual({
      provider: "VIMEO",
      id: "76979871",
    });
  });

  it("rejects an invalid video id even on a trusted host", () => {
    expect(parseVideoEmbedUrl("https://www.youtube.com/watch?v=not-eleven-chars")).toBeNull();
    expect(parseVideoEmbedUrl("https://vimeo.com/not-a-number")).toBeNull();
  });

  it("rejects untrusted hosts entirely", () => {
    expect(parseVideoEmbedUrl("https://evil.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });

  it("rejects non-http(s) protocols — the classic javascript: injection vector", () => {
    expect(parseVideoEmbedUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects garbage input without throwing", () => {
    expect(parseVideoEmbedUrl("not a url at all")).toBeNull();
    expect(parseVideoEmbedUrl("")).toBeNull();
  });
});

describe("embedSrc", () => {
  it("rebuilds a privacy-enhanced YouTube embed URL", () => {
    expect(embedSrc({ provider: "YOUTUBE", id: "abc12345678" })).toBe(
      "https://www.youtube-nocookie.com/embed/abc12345678",
    );
  });

  it("rebuilds a Vimeo player URL", () => {
    expect(embedSrc({ provider: "VIMEO", id: "123456" })).toBe(
      "https://player.vimeo.com/video/123456",
    );
  });
});
