import { describe, expect, it } from "vitest";
import {
  VIEW_ONCE_LIFETIME_MS,
  VIEW_ONCE_MAX_FRAME_BYTES,
  VIEW_ONCE_MAX_IMAGE_BYTES,
  VIEW_ONCE_MAX_VIDEO_BYTES,
  VIEW_ONCE_DOWNLOAD_URL_TTL_SECONDS,
  VIEW_ONCE_RETRY_WINDOW_MS,
  VIEW_ONCE_SWEEP_AFTER_OPEN_MS,
  viewOnceCanPlay,
  viewOnceContentType,
  viewOnceLabel,
  viewOnceMaxBytes,
  viewOnceMediaIsDue,
  viewOnceOpenDecision,
  viewOnceState,
} from "./view-once";
import { MEDIA_LIMITS, isPrivateKeyOwnedBy, privateObjectKey, viewOnceFinalKey } from "./storage";

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const at = (offsetMs: number) => new Date(NOW + offsetMs);
const unopened = { viewOnceOpenedAt: null, viewOnceExpiresAt: at(VIEW_ONCE_LIFETIME_MS) };

describe("viewOnceContentType", () => {
  it("allows the photo and video types a chat already accepts", () => {
    expect(viewOnceContentType("image/jpeg")).toEqual({ mediaType: "IMAGE", ext: "jpg" });
    expect(viewOnceContentType("image/webp")?.mediaType).toBe("IMAGE");
    expect(viewOnceContentType("image/gif")?.mediaType).toBe("IMAGE");
    expect(viewOnceContentType("video/mp4")).toEqual({ mediaType: "VIDEO", ext: "mp4" });
    expect(viewOnceContentType("video/quicktime")?.ext).toBe("mov");
  });

  it("refuses anything else", () => {
    expect(viewOnceContentType("audio/webm")).toBeNull();
    expect(viewOnceContentType("application/pdf")).toBeNull();
    expect(viewOnceContentType("image/svg+xml")).toBeNull();
    expect(viewOnceContentType("toString")).toBeNull();
  });
});

describe("size caps", () => {
  it("keeps the image cap equal to an ordinary message image and the frame cap equal to a video thumbnail", () => {
    expect(VIEW_ONCE_MAX_IMAGE_BYTES).toBe(MEDIA_LIMITS["message-image"]);
    expect(VIEW_ONCE_MAX_FRAME_BYTES).toBe(MEDIA_LIMITS["video-thumb"]);
  });

  it("caps video at 64MB", () => {
    expect(viewOnceMaxBytes("VIDEO")).toBe(64 * 1024 * 1024);
    expect(viewOnceMaxBytes("VIDEO")).toBe(VIEW_ONCE_MAX_VIDEO_BYTES);
    expect(viewOnceMaxBytes("IMAGE")).toBe(VIEW_ONCE_MAX_IMAGE_BYTES);
  });
});

describe("viewOnceOpenDecision", () => {
  it("lets an unopened, unexpired message be claimed", () => {
    expect(viewOnceOpenDecision({ ...unopened, hasMedia: true }, NOW)).toBe("claim");
  });

  it("reports an unopened message past its expiry, or with no file left, as expired", () => {
    expect(viewOnceOpenDecision({ viewOnceOpenedAt: null, viewOnceExpiresAt: at(-1), hasMedia: true }, NOW)).toBe("expired");
    expect(viewOnceOpenDecision({ viewOnceOpenedAt: null, viewOnceExpiresAt: at(0), hasMedia: true }, NOW)).toBe("expired");
    expect(viewOnceOpenDecision({ ...unopened, hasMedia: false }, NOW)).toBe("expired");
  });

  it("re-issues a link only inside the retry window and only while the file exists", () => {
    const justOpened = { viewOnceOpenedAt: at(-30_000), viewOnceExpiresAt: at(VIEW_ONCE_LIFETIME_MS) };
    expect(viewOnceOpenDecision({ ...justOpened, hasMedia: true }, NOW)).toBe("reissue");
    expect(viewOnceOpenDecision({ ...justOpened, hasMedia: false }, NOW)).toBe("already_viewed");

    const atEdge = { ...justOpened, viewOnceOpenedAt: at(-VIEW_ONCE_RETRY_WINDOW_MS) };
    expect(viewOnceOpenDecision({ ...atEdge, hasMedia: true }, NOW)).toBe("reissue");
    const pastEdge = { ...justOpened, viewOnceOpenedAt: at(-VIEW_ONCE_RETRY_WINDOW_MS - 1) };
    expect(viewOnceOpenDecision({ ...pastEdge, hasMedia: true }, NOW)).toBe("already_viewed");
  });

  it("never offers a claim on something already opened, even if it has since expired", () => {
    const opened = { viewOnceOpenedAt: at(-60 * 60 * 1000), viewOnceExpiresAt: at(-1) };
    expect(viewOnceOpenDecision({ ...opened, hasMedia: true }, NOW)).toBe("already_viewed");
  });

  it("accepts ISO strings as well as Dates", () => {
    expect(
      viewOnceOpenDecision(
        { viewOnceOpenedAt: at(-1000).toISOString(), viewOnceExpiresAt: at(1000).toISOString(), hasMedia: true },
        NOW,
      ),
    ).toBe("reissue");
  });
});

describe("viewOnceMediaIsDue", () => {
  it("leaves an unopened, unexpired file alone", () => {
    expect(viewOnceMediaIsDue(unopened, NOW)).toBe(false);
  });

  it("is due once an unopened message expires", () => {
    expect(viewOnceMediaIsDue({ viewOnceOpenedAt: null, viewOnceExpiresAt: at(-1) }, NOW)).toBe(true);
  });

  it("waits 4 minutes after an open: the retry window, a last-moment link's whole life, and a margin", () => {
    expect(VIEW_ONCE_SWEEP_AFTER_OPEN_MS).toBe(4 * 60 * 1000);
    expect(VIEW_ONCE_SWEEP_AFTER_OPEN_MS).toBeGreaterThan(
      VIEW_ONCE_RETRY_WINDOW_MS + VIEW_ONCE_DOWNLOAD_URL_TTL_SECONDS * 1000,
    );
  });

  it("is due only after that cutoff", () => {
    expect(viewOnceMediaIsDue({ ...unopened, viewOnceOpenedAt: at(-VIEW_ONCE_RETRY_WINDOW_MS - 1) }, NOW)).toBe(false);
    expect(viewOnceMediaIsDue({ ...unopened, viewOnceOpenedAt: at(-VIEW_ONCE_SWEEP_AFTER_OPEN_MS) }, NOW)).toBe(false);
    expect(viewOnceMediaIsDue({ ...unopened, viewOnceOpenedAt: at(-VIEW_ONCE_SWEEP_AFTER_OPEN_MS - 1) }, NOW)).toBe(true);
  });

  it("never deletes a file a re-issued link can still point at", () => {
    const linkMs = VIEW_ONCE_DOWNLOAD_URL_TTL_SECONDS * 1000;
    for (const ago of [0, 1000, VIEW_ONCE_RETRY_WINDOW_MS - 1, VIEW_ONCE_RETRY_WINDOW_MS]) {
      const message = { ...unopened, viewOnceOpenedAt: at(-ago) };
      expect(viewOnceOpenDecision({ ...message, hasMedia: true }, NOW)).toBe("reissue");
      // A link issued now is valid until NOW + linkMs: the file must not be due at any point before then.
      expect(viewOnceMediaIsDue(message, NOW)).toBe(false);
      expect(viewOnceMediaIsDue(message, NOW + linkMs)).toBe(false);
    }
    const longAgo = { ...unopened, viewOnceOpenedAt: at(-10 * 60 * 1000) };
    expect(viewOnceMediaIsDue(longAgo, NOW)).toBe(true);
    expect(viewOnceOpenDecision({ ...longAgo, hasMedia: true }, NOW)).toBe("already_viewed");
  });
});

describe("viewOnceCanPlay", () => {
  const mp4AndWebmOnly = (type: string) => (type === "video/mp4" || type === "video/webm" ? "maybe" : "");

  it("refuses a video type the device reports it can't play", () => {
    expect(viewOnceCanPlay("video/quicktime", mp4AndWebmOnly)).toBe(false);
    expect(viewOnceCanPlay("video/mp4", mp4AndWebmOnly)).toBe(true);
    expect(viewOnceCanPlay("video/quicktime", () => "probably")).toBe(true);
  });

  it("never refuses a photo", () => {
    expect(viewOnceCanPlay("image/jpeg", () => "")).toBe(true);
    expect(viewOnceCanPlay("image/gif", () => "")).toBe(true);
  });
});

describe("viewOnceState", () => {
  it("shows the recipient something to tap only while unopened and unexpired", () => {
    expect(viewOnceState({ ...unopened, mine: false }, NOW)).toBe("available");
    expect(viewOnceState({ ...unopened, mine: false, viewOnceOpenedAt: at(-1) }, NOW)).toBe("opened");
    expect(viewOnceState({ viewOnceOpenedAt: null, viewOnceExpiresAt: at(-1), mine: false }, NOW)).toBe("expired");
  });

  it("never gives the sender anything to tap", () => {
    expect(viewOnceState({ ...unopened, mine: true }, NOW)).toBe("sent");
    expect(viewOnceState({ ...unopened, mine: true, viewOnceOpenedAt: at(-1) }, NOW)).toBe("opened");
    expect(viewOnceState({ viewOnceOpenedAt: null, viewOnceExpiresAt: at(-1), mine: true }, NOW)).toBe("expired");
    expect(viewOnceState({ ...unopened, mine: true, sending: true }, NOW)).toBe("sending");
  });

  it("keeps showing 'opened' after the expiry date passes", () => {
    expect(viewOnceState({ viewOnceOpenedAt: at(-5), viewOnceExpiresAt: at(-1), mine: false }, NOW)).toBe("opened");
  });
});

describe("viewOnceLabel", () => {
  it("names the media for the recipient and the sender", () => {
    expect(viewOnceLabel("available", "IMAGE")).toBe("Photo · tap to view once");
    expect(viewOnceLabel("available", "VIDEO")).toBe("Video · tap to view once");
    expect(viewOnceLabel("sent", "IMAGE")).toBe("View-once photo sent");
    expect(viewOnceLabel("sent", "VIDEO")).toBe("View-once video sent");
    expect(viewOnceLabel("opened", "VIDEO")).toBe("Opened");
    expect(viewOnceLabel("expired", "IMAGE")).toBe("Expired");
  });
});

describe("private object keys", () => {
  it("are namespaced by purpose and uploader, and unguessable", () => {
    const a = privateObjectKey("view-once", "user_1", "jpg");
    const b = privateObjectKey("view-once", "user_1", "jpg");
    expect(a).toMatch(/^view-once\/user_1\/[0-9a-f-]{36}\.jpg$/);
    expect(a).not.toBe(b);
  });

  it("are only accepted from their own uploader and for the right purpose", () => {
    const key = privateObjectKey("view-once", "user_1", "mp4");
    expect(isPrivateKeyOwnedBy(key, "view-once", "user_1")).toBe(true);
    expect(isPrivateKeyOwnedBy(key, "view-once", "user_2")).toBe(false);
    expect(isPrivateKeyOwnedBy(key, "view-once-frame", "user_1")).toBe(false);
    expect(isPrivateKeyOwnedBy("view-once/user_1/../user_2/x.jpg", "view-once", "user_1")).toBe(false);
    expect(isPrivateKeyOwnedBy("message-image/user_1/abc.jpg", "view-once", "user_1")).toBe(false);
  });

  it("keep a sent file under a key that is never accepted from a client", () => {
    const final = viewOnceFinalKey("conv_1", "jpg");
    expect(final).toMatch(/^view-once-final\/conv_1\/[0-9a-f-]{36}\.jpg$/);
    expect(final).not.toBe(viewOnceFinalKey("conv_1", "jpg"));
    expect(isPrivateKeyOwnedBy(final, "view-once", "conv_1")).toBe(false);
    expect(isPrivateKeyOwnedBy(final, "view-once-frame", "conv_1")).toBe(false);
    expect(isPrivateKeyOwnedBy(final, "view-once", "view-once-final")).toBe(false);
  });
});
