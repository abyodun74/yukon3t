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

  it("parses a /live/ URL", () => {
    expect(parseVideoEmbedUrl("https://www.youtube.com/live/dQw4w9WgXcQ")).toEqual({
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

  it("parses Instagram post/reel/tv URLs, keeping the post type as part of the id", () => {
    expect(parseVideoEmbedUrl("https://www.instagram.com/reel/CxAbc123-_/")).toEqual({
      provider: "INSTAGRAM",
      id: "reel/CxAbc123-_",
    });
    expect(parseVideoEmbedUrl("https://instagram.com/p/CxAbc123/")).toEqual({
      provider: "INSTAGRAM",
      id: "p/CxAbc123",
    });
    expect(parseVideoEmbedUrl("https://www.instagram.com/tv/CxAbc123/")).toEqual({
      provider: "INSTAGRAM",
      id: "tv/CxAbc123",
    });
  });

  it("rejects an Instagram URL that isn't a post/reel/tv link", () => {
    expect(parseVideoEmbedUrl("https://www.instagram.com/someuser/")).toBeNull();
  });

  it("parses Facebook watch/videos/reel URLs", () => {
    expect(parseVideoEmbedUrl("https://www.facebook.com/watch?v=1234567890")).toEqual({
      provider: "FACEBOOK",
      id: "watch?v=1234567890",
    });
    expect(parseVideoEmbedUrl("https://www.facebook.com/someuser/videos/1234567890")).toEqual({
      provider: "FACEBOOK",
      id: "someuser/videos/1234567890",
    });
    expect(parseVideoEmbedUrl("https://www.facebook.com/reel/1234567890")).toEqual({
      provider: "FACEBOOK",
      id: "reel/1234567890",
    });
  });

  it("rejects a Facebook URL that isn't a watch/videos/reel link", () => {
    expect(parseVideoEmbedUrl("https://www.facebook.com/someuser/")).toBeNull();
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
  it("rebuilds a privacy-enhanced YouTube embed URL, requesting muted autoplay", () => {
    expect(embedSrc({ provider: "YOUTUBE", id: "abc12345678" })).toBe(
      "https://www.youtube-nocookie.com/embed/abc12345678?autoplay=1&mute=1&playsinline=1",
    );
  });

  it("rebuilds a Vimeo player URL, requesting muted autoplay", () => {
    expect(embedSrc({ provider: "VIMEO", id: "123456" })).toBe(
      "https://player.vimeo.com/video/123456?autoplay=1&muted=1&playsinline=1",
    );
  });

  it("rebuilds an Instagram embed URL, preserving the post type (no autoplay param — not documented for this provider)", () => {
    expect(embedSrc({ provider: "INSTAGRAM", id: "reel/CxAbc123" })).toBe(
      "https://www.instagram.com/reel/CxAbc123/embed",
    );
  });

  it("rebuilds a Facebook video plugin URL, requesting muted autoplay", () => {
    expect(embedSrc({ provider: "FACEBOOK", id: "someuser/videos/1234567890" })).toBe(
      "https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Fsomeuser%2Fvideos%2F1234567890&show_text=false&autoplay=true&mute=1",
    );
  });
});
