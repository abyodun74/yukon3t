import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every place a post's video can play, travel or be saved keeps the original sound out when the author replaced it
// with built-in music (src/lib/post-music.ts). Source checks, the way motion-defaults.test.ts guards motion: a refactor
// that drops one of these gates fails here instead of quietly leaking the file's own sound.

const read = (file: string) => readFileSync(join(process.cwd(), "src", file), "utf8");

describe("post music on every surface", () => {
  it("the feed card mutes a video that has music and lets the music follow it", () => {
    const card = read("components/post-card.tsx");
    expect(card).toMatch(/muted=\{muted \|\| videoMusic !== null\}/);
    expect(card).toMatch(/videoRef\.current\.muted = muted \|\| videoMusic !== null/);
    expect(card).toMatch(/useVideoMusic\(videoRef, videoMusic, muted, framed\)/);
    // The full-screen viewer gets the music (and so no Save, no native controls).
    expect(card).toMatch(/videoMusic=\{shownVideoMusic \?\? undefined\}/);
    expect(card).toMatch(/musicTrack=\{shownMusic\}/);
  });

  it("the full-screen viewer never offers Save or native controls for a music video", () => {
    const lightbox = read("components/lightbox.tsx");
    expect(lightbox).toMatch(/!\(video && videoMusic\) && <SaveButton/);
    expect(lightbox).toMatch(/video && !videoMusic && \(/);
    const player = read("components/music-video-player.tsx");
    const tag = player.slice(player.indexOf("<video"), player.indexOf("/>", player.indexOf("<video")));
    expect(tag).toMatch(/\n\s+muted\r?\n/);
    expect(tag).not.toMatch(/\n\s+controls[\s=]/);
    expect(tag).toMatch(/controlsList="nodownload"/);
  });

  it("the share sheet sends a music video as a link only and keeps it out of Story and Muse", () => {
    const share = read("components/share-modal.tsx");
    expect(share).toMatch(/const musicVideo = musicReplacesVideoSound\(\{ mediaType, musicTrack \}\)/);
    expect(share).toMatch(/const canShareToStory = !musicVideo &&/);
    expect(share).toMatch(/const canShareToMuse =\s+!musicVideo &&/);
    expect(share).toMatch(/!musicVideo && \(mediaType === "IMAGE" \|\| mediaType === "VIDEO" \|\| mediaType === "GIF"\)/);
    const actions = read("app/actions/shares.ts");
    expect(actions.match(/if \(musicReplacesVideoSound\(root\)\)/g)?.length).toBe(2);
  });

  it("the Muse viewer opened from Home plays the post's music and never swaps in the Muse copy", () => {
    const muse = read("components/muse-feed.tsx");
    expect(muse).toMatch(/const muse = seedMusic \? null : \(seed\?\.item \?\? null\)/);
    expect(muse).toMatch(/postMusicUrl\(seedMusic\)/);
    // A separate sound track always mutes the video (existing Muse rule the music relies on).
    expect(muse).toMatch(/muted=\{Boolean\(item\.audioUrl\) \|\| muted \|\| soundBlocked\}/);
  });

  it("the shared music element holds itself (the media guard doesn't resume it behind a viewer or a call)", () => {
    const player = read("lib/post-music-player.ts");
    expect(player).toMatch(/el\.setAttribute\(SELF_HELD_MEDIA_ATTR, "self"\)/);
    expect(player).toMatch(/subscribeCallMediaHold\(/);
    expect(player).toMatch(/subscribePageMediaHold\(\(\) => coordinator\.interrupt\("viewer"\)\)/);
    expect(player).toMatch(/coordinator\.interrupt\("hidden"\)/);
  });
});
