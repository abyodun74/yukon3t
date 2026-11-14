// Source-scan guard (iPhone upload retries, 2026-11): iOS WebKit limits media decoders and total canvas memory per
// page, so a hidden <video>, a <canvas> or an object URL left for the garbage collector after a failed or timed-out
// attempt can make every later resize / frame capture on the page fail. Every one created in upload-client.ts must be
// released on every path, in a `finally` or in the single settle function (`finish`) every path goes through. And the
// post composer may no longer call createPost or the presign action through the Server Action queue (see
// post-submit-attempt.ts), whose stuck requests were what kept later attempts failing.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** Drops // and /* comments so prose mentioning these APIs doesn't count. Strings are kept (the scan needs them). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

type Fn = { name: string; body: string };

/** Top-level functions (declarations and `export function`), with their bodies. */
function topLevelFunctions(code: string): Fn[] {
  const fns: Fn[] = [];
  const decl = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm;
  for (const m of code.matchAll(decl)) {
    const open = code.indexOf("{", code.indexOf(")", m.index!));
    let depth = 0;
    let i = open;
    for (; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}" && --depth === 0) break;
    }
    fns.push({ name: m[1], body: code.slice(open, i + 1) });
  }
  return fns;
}

/** The text of every `finally { ... }` block and of every `const finish = (...) => { ... }` settle function. */
function releaseRegions(body: string): string {
  let out = "";
  const starts = [...body.matchAll(/finally\s*\{/g), ...body.matchAll(/const finish = \([^)]*\) => \{/g)];
  for (const m of starts) {
    const open = m.index! + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < body.length; i++) {
      if (body[i] === "{") depth++;
      else if (body[i] === "}" && --depth === 0) {
        out += body.slice(open, i + 1) + "\n";
        break;
      }
    }
  }
  return out;
}

const UPLOAD_CLIENT = stripComments(read("src/lib/upload-client.ts"));
const FUNCTIONS = topLevelFunctions(UPLOAD_CLIENT);

describe("upload-client.ts releases every media resource it creates", () => {
  it("finds the functions that create them (scanner sanity check)", () => {
    const names = FUNCTIONS.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(["resizeImageToMax", "captureVideoFrameDetailed", "probeVideoDuration"]));
  });

  it("every URL.createObjectURL is revoked in a finally / finish of the same function", () => {
    const offenders: string[] = [];
    let created = 0;
    for (const fn of FUNCTIONS) {
      const n = (fn.body.match(/URL\.createObjectURL\(/g) ?? []).length;
      if (n === 0) continue;
      created += n;
      const regions = releaseRegions(fn.body);
      const revokes =
        (regions.match(/URL\.revokeObjectURL\(/g) ?? []).length + (regions.match(/releaseProbeVideo\(/g) ?? []).length;
      if (revokes < n) offenders.push(fn.name);
    }
    expect(created).toBeGreaterThanOrEqual(3);
    expect(offenders).toEqual([]);
  });

  it("releaseProbeVideo empties the element and revokes its URL", () => {
    const fn = FUNCTIONS.find((f) => f.name === "releaseProbeVideo")!;
    expect(fn.body).toContain('removeAttribute("src")');
    expect(fn.body).toContain(".load()");
    expect(fn.body).toContain("URL.revokeObjectURL(");
  });

  it("every hidden <video> is released in a finally / finish of the function that made it", () => {
    const offenders: string[] = [];
    for (const fn of FUNCTIONS) {
      if (fn.name === "hiddenProbeVideo") continue; // the factory itself
      const made = (fn.body.match(/hiddenProbeVideo\(|createElement\("video"\)/g) ?? []).length;
      if (made === 0) continue;
      if (!/releaseProbeVideo\(/.test(releaseRegions(fn.body))) offenders.push(fn.name);
    }
    expect(offenders).toEqual([]);
  });

  it("every <canvas> is released (width/height 0) in a finally / finish of the function that made it", () => {
    const offenders: string[] = [];
    let created = 0;
    for (const fn of FUNCTIONS) {
      const made = (fn.body.match(/createElement\("canvas"\)/g) ?? []).length;
      if (made === 0) continue;
      created += made;
      const released = (releaseRegions(fn.body).match(/releaseCanvas\(/g) ?? []).length;
      if (released < made) offenders.push(fn.name);
    }
    expect(created).toBeGreaterThanOrEqual(3);
    expect(offenders).toEqual([]);
    const release = FUNCTIONS.find((f) => f.name === "releaseCanvas")!;
    expect(release.body).toMatch(/\.width = 0/);
    expect(release.body).toMatch(/\.height = 0/);
  });

  it("the image decode in the resize is bounded by a timer that is cleared on every path", () => {
    const fn = FUNCTIONS.find((f) => f.name === "resizeImageToMax")!;
    expect(fn.body).toContain("IMAGE_DECODE_TIMEOUT_MS");
    expect(releaseRegions(fn.body)).toContain("clearTimeout(");
    expect(releaseRegions(fn.body)).toContain("releaseImage(");
  });

  it("every frame-capture and probe timer is cleared in its settle function", () => {
    const capture = FUNCTIONS.find((f) => f.name === "captureVideoFrameDetailed")!;
    const probe = FUNCTIONS.find((f) => f.name === "probeVideoDuration")!;
    expect(releaseRegions(capture.body)).toMatch(/clearTimeout\(overallTimer\)/);
    expect(releaseRegions(capture.body)).toMatch(/clearTimeout\(stallTimer\)/);
    expect(releaseRegions(probe.body)).toMatch(/clearTimeout\(timeout\)/);
  });

  it("every fetch goes through fetchWithTimeout (abortable, timer cleared)", () => {
    const bare = FUNCTIONS.filter((f) => f.name !== "fetchWithTimeout" && /(^|[^A-Za-z.])fetch\(/.test(f.body));
    expect(bare.map((f) => f.name)).toEqual([]);
    const fwt = FUNCTIONS.find((f) => f.name === "fetchWithTimeout")!;
    expect(fwt.body).toContain("new AbortController()");
    expect(fwt.body).toContain("clearTimeout(timer)");
  });
});

describe("the post upload path doesn't go through the Server Action queue", () => {
  it("presigning uses the /api/uploads/presign route, not the requestUploadUrls action", () => {
    expect(UPLOAD_CLIENT).toContain('"/api/uploads/presign"');
    expect(UPLOAD_CLIENT).not.toMatch(/\brequestUploadUrls\(/);
  });

  it("the post composer sends createPost through /api/posts (post-create-client.ts)", () => {
    const composer = stripComments(read("src/components/post-composer.tsx"));
    expect(composer).not.toMatch(/\bcreatePost\(/);
    expect(composer).toContain("submitCreatePost(");
    expect(composer).not.toContain("submittingRef");
  });
});

describe("post composer object URLs", () => {
  it("the image previews are revoked, and the optimistic preview is owned (and revoked) by the store", () => {
    const composer = stripComments(read("src/components/post-composer.tsx"));
    expect(composer).toMatch(/imagePreviewUrls\.forEach\(\(url\) => URL\.revokeObjectURL\(url\)\)/);
    const store = stripComments(read("src/lib/optimistic-posts-store.ts"));
    expect(store).toMatch(/removeOptimisticPost[\s\S]*URL\.revokeObjectURL\(entry\.previewUrl\)/);
    // A failed post comes back into the composer and its card is removed, revoking that preview.
    expect(composer).toMatch(/function applyFailedDraft[\s\S]*removeOptimisticPost\(draft\.localId\)/);
  });

  it("every file input is cleared after a pick, so picking the same file again fires change", () => {
    const composer = read("src/components/post-composer.tsx");
    const inputs = composer.match(/<input\s+ref=\{(?:image|camera|video)InputRef\}[\s\S]*?\/>/g) ?? [];
    expect(inputs).toHaveLength(3);
    for (const input of inputs) expect(input).toContain('e.target.value = ""');
  });
});
