import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { putAttemptOutcome, WRITE_ONCE_PUT_HEADERS } from "./write-once-upload";

describe("putAttemptOutcome: write-once PUT retry semantics", () => {
  it("2xx is stored on any attempt", () => {
    for (const attempt of [1, 2, 6]) {
      expect(putAttemptOutcome(200, attempt)).toBe("ok");
      expect(putAttemptOutcome(204, attempt)).toBe("ok");
    }
  });

  it("412 on a retry means an earlier attempt of this upload already stored the key", () => {
    expect(putAttemptOutcome(412, 2)).toBe("ok");
    expect(putAttemptOutcome(412, 6)).toBe("ok");
  });

  it("412 on the first attempt is never success: the key was written by something other than this upload", () => {
    expect(putAttemptOutcome(412, 1)).toBe("failed");
  });

  it("storage 5xx/429/408/425 are retried; other statuses are final", () => {
    for (const status of [500, 502, 503, 504, 429, 408, 425]) expect(putAttemptOutcome(status, 1)).toBe("retry");
    for (const status of [400, 403, 404, 411]) expect(putAttemptOutcome(status, 2)).toBe("failed");
  });

  it("the header the client must send is exactly If-None-Match: *", () => {
    expect(WRITE_ONCE_PUT_HEADERS).toEqual({ "If-None-Match": "*" });
    expect(Object.isFrozen(WRITE_ONCE_PUT_HEADERS)).toBe(true);
  });
});

// Source scan: every PUT this codebase sends to a presigned public-media URL must carry the signed headers, or R2
// refuses it (403). The only browser PUTs live in upload-client.ts; a new one anywhere else must be reviewed here.
const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "generated" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}
const files = sourceFiles(SRC).map((path) => ({ rel: relative(SRC, path).replace(/\\/g, "/"), text: readFileSync(path, "utf8") }));
const read = (rel: string) => files.find((f) => f.rel === rel)!.text;

describe("every PUT to a presigned public-media URL sends the write-once header", () => {
  it("browser PUTs exist only in lib/upload-client.ts", () => {
    const withPut = files.filter((f) => /method:\s*["']PUT["']|\.open\(\s*["']PUT["']/.test(f.text)).map((f) => f.rel);
    expect(withPut).toEqual(["lib/upload-client.ts"]);
  });

  it("upload-client.ts: the single PUT to a createUploadUrl URL spreads the signed headers; the others are part or private-bucket URLs", () => {
    const text = read("lib/upload-client.ts");
    const puts = [...text.matchAll(/fetchWithTimeout\(\s*(\w+(?:\[\w+\])?)\s*,\s*\{([\s\S]*?)\}\s*,/g)].map((m) => ({ url: m[1], init: m[2] }));
    const byUrl = Object.fromEntries(puts.map((p) => [p.url, p.init]));
    // createUploadUrl (public bucket, single PUT): must send the signed headers, and Content-Type can't override them.
    expect(byUrl.uploadUrl).toMatch(/headers:\s*\{\s*\.\.\.signedHeaders,\s*"Content-Type"/);
    // Multipart part URLs (die with the upload id on completion) and the two private buckets (server-side copy to a
    // final key) are not createUploadUrl URLs.
    expect(Object.keys(byUrl).sort()).toEqual(["partUrls[index]", "uploadUrl", "url"].sort());
    expect(text).toMatch(/requestUploadUrls\(\s*chunk\.map\(\(p\) => p\.item\),\s*WRITE_ONCE_UPLOAD_PROTOCOL,?\s*\)/);
    expect(text).toMatch(/!result\.headers\)/);
    expect(text).toMatch(/putAttemptOutcome\(res\.status, attempt\)/);
  });

  it("createUploadUrl signs the condition and is only called by actions that return its headers", () => {
    const storage = read("lib/storage.ts");
    expect(storage).toMatch(/new PutObjectCommand\(\{ Bucket: bucket, Key: key, ContentType: contentType, IfNoneMatch: "\*" \}\)/);
    expect(storage).toMatch(/unhoistableHeaders: new Set\(\["if-none-match"\]\)/);
    const callers = files.filter((f) => f.rel !== "lib/storage.ts" && /\bcreateUploadUrl\(/.test(f.text)).map((f) => f.rel).sort();
    expect(callers).toEqual(["app/actions/ads.ts", "app/actions/media.ts"]);
    expect(read("app/actions/media.ts")).toMatch(/return \{ error: null, uploadUrl, publicUrl, key, headers \}/);
    // ads.ts returns createUploadUrl's whole result objects (main/thumb), headers included.
    expect(read("app/actions/ads.ts")).toMatch(/return \{ error: null, main, thumb, pass \}/);
  });

  it("the native Android video uploader (no header support in installed builds) is only ever handed a part URL", () => {
    const calls = files.flatMap((f) => [...f.text.matchAll(/uploadVideoNative\(([^)]*)\)/g)].map((m) => ({ rel: f.rel, args: m[1] })));
    const realCalls = calls.filter((c) => !/uri: string/.test(c.args)); // drop the definition itself
    expect(realCalls.length).toBeGreaterThan(0);
    for (const c of realCalls) expect(c.args).toMatch(/\.partUrl\b/);
  });
});
