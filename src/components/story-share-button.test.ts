import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Story "Share" sheet (story-share-button.tsx). Before, a guest or an unverified account (getShareableConversations
// runs requireVerifiedUser, which throws) or a lost request opened the sheet and left it on "Loading…" forever, with an
// unhandled rejection: the share looked broken with no message. Guards both answers.

const source = readFileSync(join(__dirname, "story-share-button.tsx"), "utf8");

function openSheetBody(): string {
  const start = source.indexOf("async function openSheet()");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n  }\n", start);
  return source.slice(start, end);
}

describe("Story share sheet", () => {
  it("prompts a guest to sign up instead of opening a sheet that can't load", () => {
    const body = openSheetBody();
    const guest = body.indexOf("if (isGuest)");
    expect(guest).toBeGreaterThan(-1);
    expect(body.slice(guest, body.indexOf("}", guest))).toMatch(/promptSignUp\(\);\s*return;/);
    // Checked before the sheet is opened (and the viewer paused).
    expect(guest).toBeLessThan(body.indexOf("setOpen(true)"));
  });

  it("catches a failed chat-list load and shows the failure instead of loading forever", () => {
    const body = openSheetBody();
    expect(body).toMatch(/try\s*\{[\s\S]*await getShareableConversations\(\)[\s\S]*\}\s*catch\s*\{[\s\S]*setLoadFailed\(true\)/);
    expect(source).toMatch(/loadFailed \? \([\s\S]*role="alert"[\s\S]*t\.stories\.shareSheet\.failed/);
  });

  it("retries the load on the next open after a failure (the list stays unset)", () => {
    const body = openSheetBody();
    expect(body).toMatch(/if \(conversations === null\) \{\s*setLoadFailed\(false\);/);
  });
});
