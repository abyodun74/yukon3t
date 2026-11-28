import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { MEDIA_REFERENCE_COLUMNS } from "./upload-records";

// Every schema column that looks like it could hold a URL or storage key must either be checked by
// findReferencedUrls (MEDIA_REFERENCE_COLUMNS) or be listed here with the reason it can never hold one of the uploads
// the abandoned-upload sweep records (SWEEPABLE_KINDS: public-bucket post/message/comment/story/muse/ad media, all
// presigned keys `<kind>/<userId>/<uuid>.<ext>`). A new column that fails this test needs a decision, not a guess:
// add it to findReferencedUrls, or add it here with a real reason.
const EXCLUDED: Record<string, string> = {
  "LoginFailureCounter.subjectKey": "SHA-256 lockout key, not storage",
  "LoginFailureCounter.sourceKey": "SHA-256 lockout key, not storage",
  "RateLimitFallback.key": "rate-limit bucket name, not storage",
  "HolidayReminder.holidayKey": "holiday catalogue id",
  "User.avatarUrl": "same-origin /api/avatar/... route form in the private avatar bucket, never a public upload URL",
  "Channel.voiceRoomUrl": "Daily.co room URL",
  "CollabBoardPost.roomUrl": "Daily.co room URL",
  "LiveStream.roomUrl": "Daily.co room URL",
  "Call.roomUrl": "Daily.co room URL",
  "AppVersionPolicy.storeUrl": "App Store / Play Store listing URL",
  "Post.videoStreamUid": "Cloudflare Stream id, not a URL",
  "Comment.videoStreamUid": "Cloudflare Stream id, not a URL",
  "Muse.videoStreamUid": "Cloudflare Stream id, not a URL",
  "Comment.gifUrl": "Giphy URL, validated as one (isGiphyUrl) before it is stored",
  "MuseComment.gifUrl": "Giphy URL, validated as one before it is stored",
  "LiveStreamRecordingPost.r2VideoUrl":
    "server-written key (uploadStream, fresh UUID) for a Daily recording copy, never a presigned upload; its lifecycle is live-stream-recording-post.ts",
  "LiveStreamRecordingPost.thumbnailUrl": "server-written key (fresh UUID), never a presigned upload",
  "VideoConversion.outputUrl": "server-written MP4 key (fresh UUID), swapped into the rows that used the .mov",
  "BrandedVideoRendition.sourceUrl":
    "a cache entry for a video already used by a post/Muse (those rows are the references); counting it would keep deleted posts' files forever",
  "BrandedVideoRendition.outputUrl": "server-written watermarked copy, never a presigned upload",
  "UserEncryptionKey.publicKey": "E2EE key material",
  "UserEncryptionKey.wrappedPrivateKey": "E2EE key material",
  "ViewOnceMedia.objectKey": "private view-once bucket key (view-once-final/...), never in the public bucket",
  "UploadRecord.key": "the upload record itself",
  "GiftItem.assetKey": "static gift art in /public, not an upload",
  "CoinLedgerEntry.idempotencyKey": "request id",
  "AnalyticsEvent.metadata":
    "telemetry JSON; media diagnostics never carry a URL or storage key (media-upload-diagnostics.ts)",
};

const URL_LIKE = /(url|urls|uri|href|path)$|^key$|Key$|image|media|thumb|poster|photo|avatar|asset|attach|audio|video|cover|file/i;

function urlLikeColumns(): string[] {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const out: string[] = [];
  let model: string | null = null;
  for (const line of schema.split(/\r?\n/)) {
    const start = /^model\s+(\w+)\s*\{/.exec(line);
    if (start) {
      model = start[1];
      continue;
    }
    if (/^\}/.test(line)) {
      model = null;
      continue;
    }
    if (!model) continue;
    const field = /^\s+(\w+)\s+(String|Json)(\[\])?\??(\s|$)/.exec(line);
    if (!field) continue;
    const [, name, type] = field;
    if (type === "Json" || URL_LIKE.test(name)) out.push(`${model}.${name}`);
  }
  return out;
}

describe("upload reference check coverage", () => {
  const columns = urlLikeColumns();

  it("finds the schema's URL-like columns", () => {
    expect(columns).toContain("Post.mediaUrls");
    expect(columns).toContain("Announcement.mediaUrl");
    expect(columns.length).toBeGreaterThan(30);
  });

  it("every URL-like column is checked by findReferencedUrls or explicitly excluded", () => {
    const covered = new Set<string>(MEDIA_REFERENCE_COLUMNS);
    const undecided = columns.filter((c) => !covered.has(c) && !(c in EXCLUDED));
    expect(undecided, "add these to findReferencedUrls or to EXCLUDED with a reason").toEqual([]);
  });

  it("lists no column twice, and nothing stale", () => {
    const all = new Set(columns);
    for (const c of MEDIA_REFERENCE_COLUMNS) {
      expect(all.has(c), `${c} is not a URL-like schema column`).toBe(true);
      expect(c in EXCLUDED, `${c} is both covered and excluded`).toBe(false);
    }
    for (const c of Object.keys(EXCLUDED)) expect(all.has(c), `${c} no longer exists`).toBe(true);
  });
});
