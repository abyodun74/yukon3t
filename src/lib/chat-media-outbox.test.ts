import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MIN_RECORDING_MS,
  formatRecordingClock,
  isAccidentalRecording,
  keepsUploadAfter,
  newOutboxItem,
  outboxFailureFor,
  outboxReducer,
  type OutboxItem,
} from "@/lib/chat-media-outbox";
import { newClientRequestId, parseClientRequestId } from "@/lib/client-request-id";

const item = (id = "rec-00000001"): OutboxItem<string> =>
  newOutboxItem({ id, conversationId: "c1", kind: "AUDIO", file: "blob", durationMs: 4200, replyToMessageId: null });

describe("recordings", () => {
  it("discards accidental taps under a second, and anything it couldn't measure", () => {
    expect(isAccidentalRecording(MIN_RECORDING_MS - 1)).toBe(true);
    expect(isAccidentalRecording(0)).toBe(true);
    expect(isAccidentalRecording(Number.NaN)).toBe(true);
    expect(isAccidentalRecording(MIN_RECORDING_MS)).toBe(false);
  });

  it("formats a length as m:ss", () => {
    expect(formatRecordingClock(7_400)).toBe("0:07");
    expect(formatRecordingClock(120_000)).toBe("2:00");
    expect(formatRecordingClock(-5)).toBe("0:00");
  });
});

describe("outbox", () => {
  it("starts uploading, and a double fire of the same recording is one item", () => {
    let items = outboxReducer([], { type: "add", item: item() });
    items = outboxReducer(items, { type: "add", item: item() });
    expect(items).toHaveLength(1);
    expect(items[0].phase).toBe("uploading");
  });

  it("goes uploading -> sending -> removed on success", () => {
    let items = outboxReducer([], { type: "add", item: item() });
    items = outboxReducer(items, { type: "uploaded", id: "rec-00000001", uploaded: { mediaUrl: "u" } });
    expect(items[0]).toMatchObject({ phase: "sending", uploaded: { mediaUrl: "u" } });
    items = outboxReducer(items, { type: "remove", id: "rec-00000001" });
    expect(items).toEqual([]);
  });

  it("keeps the upload only after a send that got no answer", () => {
    expect(keepsUploadAfter("network")).toBe(true);
    for (const f of ["upload", "moderation", "too_large", "blocked", "other"] as const) expect(keepsUploadAfter(f)).toBe(false);
    const sending = outboxReducer(outboxReducer([], { type: "add", item: item() }), {
      type: "uploaded",
      id: "rec-00000001",
      uploaded: { mediaUrl: "u" },
    });
    const lost = outboxReducer(sending, { type: "failed", id: "rec-00000001", failure: "network" });
    expect(lost[0]).toMatchObject({ phase: "failed", failure: "network", uploaded: { mediaUrl: "u" } });
    expect(outboxReducer(lost, { type: "retry", id: "rec-00000001" })[0]).toMatchObject({ phase: "sending", failure: null });
    const refused = outboxReducer(sending, { type: "failed", id: "rec-00000001", failure: "moderation" });
    expect(refused[0].uploaded).toBeNull();
    expect(outboxReducer(refused, { type: "retry", id: "rec-00000001" })[0].phase).toBe("uploading");
  });

  it("retries only a failed item, so a second tap on Retry does nothing", () => {
    const uploading = outboxReducer([], { type: "add", item: item() });
    expect(outboxReducer(uploading, { type: "retry", id: "rec-00000001" })).toEqual(uploading);
  });

  it("maps server errors to what the bubble says", () => {
    expect(outboxFailureFor("moderation")).toBe("moderation");
    expect(outboxFailureFor("hidden_locked")).toBe("hidden_locked");
    expect(outboxFailureFor("plaintext_in_secret_chat")).toBe("mode_changed");
    expect(outboxFailureFor("not_a_member")).toBe("other");
  });
});

describe("client request ids", () => {
  it("makes ids the server accepts, and rejects malformed ones", () => {
    expect(parseClientRequestId(newClientRequestId())).not.toBeNull();
    expect(parseClientRequestId("short")).toBeNull();
    expect(parseClientRequestId("bad id with spaces")).toBeNull();
    expect(parseClientRequestId(42)).toBeNull();
  });
});

describe("chat wiring", () => {
  const read = (f: string) => readFileSync(join(__dirname, "..", "components", f), "utf8");
  const chat = read("chat-thread.tsx");

  it("sends a recording when it stops, with its id as the idempotency key, and has no preview-then-send step", () => {
    expect(chat).toMatch(/<AudioRecorderModal[\s\S]*?sendsOnStop[\s\S]*?sendRecording\("AUDIO", file, info\)/);
    expect(chat).toMatch(/<VideoRecorderModal[\s\S]*?sendsOnStop[\s\S]*?sendRecording\("VIDEO", file, info\)/);
    expect(chat).toContain('fd.set("clientRequestId", item.id);');
    expect(chat).toContain("id: info.recordingId,");
    expect(chat).not.toMatch(/pendingAudio|voiceReady|removeVoice/);
  });

  it("recorders discard a cancelled or closed-mid-recording take", () => {
    for (const source of [read("video-recorder-modal.tsx"), readFileSync(join(__dirname, "use-audio-recorder.ts"), "utf8")]) {
      expect(source).toMatch(/if \(session\.discarded\) return;/);
      expect(source).toMatch(/sessionRef\.current\.discarded = true;/);
      expect(source).toContain('state !== "inactive"');
    }
    expect(read("audio-recorder-modal.tsx")).toContain("onClick={cancel}");
    expect(read("video-recorder-modal.tsx")).toContain("onClick={cancelRecording}");
  });
});
