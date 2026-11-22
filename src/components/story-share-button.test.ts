import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Story "Share" sheet (story-share-button.tsx). Before, a guest or an unverified account (getShareableConversations
// runs requireVerifiedUser, which throws) or a lost request opened the sheet and left it on "Loading…" forever, with an
// unhandled rejection: the share looked broken with no message. Guards both answers. The chat list now loads when
// "Send to chats" is opened from the sheet's root view, which also offers the Story's "Post to" rows
// (src/lib/story-reshare.ts).

const source = readFileSync(join(__dirname, "story-share-button.tsx"), "utf8").replace(/\r\n/g, "\n");

function functionBody(name: string): string {
  const start = source.indexOf(`function ${name}()`);
  expect(start, name).toBeGreaterThan(-1);
  const end = source.indexOf("\n  }\n", start);
  return source.slice(start, end);
}
const openSheetBody = () => functionBody("openSheet");
const openChatsBody = () => functionBody("openChats");

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
    const body = openChatsBody();
    expect(body).toMatch(/try\s*\{[\s\S]*await getShareableConversations\(\)[\s\S]*\}\s*catch\s*\{[\s\S]*setLoadFailed\(true\)/);
    expect(source).toContain("const text = t.stories.shareSheet;");
    expect(source).toMatch(/loadFailed \? \([\s\S]*role="alert"[\s\S]*text\.failed/);
  });

  it("retries the load on the next open after a failure (the list stays unset)", () => {
    expect(openChatsBody()).toMatch(/if \(conversations === null\) \{\s*setLoadFailed\(false\);/);
  });

  it("never lets a failed repost-options load block the sheet (Send to chats still works)", () => {
    expect(openSheetBody()).toMatch(/getStoryReshareOptions\(storyId\)[\s\S]*\.catch\(/);
  });
});
