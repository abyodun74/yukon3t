import { describe, expect, it } from "vitest";
import { checkSecretSend, inboxPreview, isSecretChat, pushPreview, textForModeration } from "./secret-chat";

const on = { e2eeEnabledAt: new Date() };
const off = { e2eeEnabledAt: null };
const CIPHERTEXT = "e2ee:v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("isSecretChat", () => {
  it("is secret only when BOTH people in a 1:1 have opted in", () => {
    expect(isSecretChat({ isGroup: false, members: [on, on] })).toBe(true);
  });
  it("is not secret with only one opt-in, or none", () => {
    expect(isSecretChat({ isGroup: false, members: [on, off] })).toBe(false);
    expect(isSecretChat({ isGroup: false, members: [off, on] })).toBe(false);
    expect(isSecretChat({ isGroup: false, members: [off, off] })).toBe(false);
  });
  it("never applies to a group, even if every row somehow has the flag", () => {
    expect(isSecretChat({ isGroup: true, members: [on, on] })).toBe(false);
    expect(isSecretChat({ isGroup: true, members: [on, on, on] })).toBe(false);
  });
  it("never applies to anything but exactly two members", () => {
    expect(isSecretChat({ isGroup: false, members: [on] })).toBe(false);
    expect(isSecretChat({ isGroup: false, members: [on, on, on] })).toBe(false);
    expect(isSecretChat({ isGroup: false, members: [] })).toBe(false);
  });
});

describe("checkSecretSend — plaintext can never slip into a secret chat", () => {
  it("refuses plaintext text in a secret chat", () => {
    expect(checkSecretSend({ secret: true, content: "hello" })).toBe("plaintext_in_secret_chat");
    expect(checkSecretSend({ secret: true, content: "e2ee:v1:looks-like-but-is-not" })).toBe("plaintext_in_secret_chat");
  });
  it("accepts well-formed ciphertext in a secret chat", () => {
    expect(checkSecretSend({ secret: true, content: CIPHERTEXT })).toBeNull();
  });
  it("accepts an empty body (a caption-less photo or voice note)", () => {
    expect(checkSecretSend({ secret: true, content: "" })).toBeNull();
  });
  it("doesn't interfere with ordinary chats", () => {
    expect(checkSecretSend({ secret: false, content: "hello" })).toBeNull();
    expect(checkSecretSend({ secret: false, content: "" })).toBeNull();
  });
  it("refuses ciphertext in an ordinary chat — otherwise the prefix would be a way to skip text moderation", () => {
    expect(checkSecretSend({ secret: false, content: CIPHERTEXT })).toBe("not_a_secret_chat");
    // Even junk that merely starts with the prefix: the server never scans such text, so it can't be let through.
    expect(checkSecretSend({ secret: false, content: "e2ee:v1:anything at all, insults included" })).toBe("not_a_secret_chat");
  });
});

describe("textForModeration — nothing from a secret chat reaches the scanner", () => {
  it("sends no text to the scanner in a secret chat", () => {
    expect(textForModeration({ secret: true, content: CIPHERTEXT })).toBe("");
    expect(textForModeration({ secret: true, content: "hello" })).toBe("");
  });
  it("never sends ciphertext to the scanner even if the chat isn't secret", () => {
    expect(textForModeration({ secret: false, content: CIPHERTEXT })).toBe("");
  });
  it("still scans ordinary text in ordinary chats", () => {
    expect(textForModeration({ secret: false, content: "hello there" })).toBe("hello there");
  });
});

describe("pushPreview — notifications never leak message text", () => {
  it("shows a generic line for secret text", () => {
    expect(pushPreview({ secret: true, content: CIPHERTEXT, mediaType: "NONE" })).toBe("New secret message");
    expect(pushPreview({ secret: true, content: "should never appear", mediaType: "NONE" })).toBe("New secret message");
  });
  it("never shows ciphertext in a non-secret chat either", () => {
    expect(pushPreview({ secret: false, content: CIPHERTEXT, mediaType: "NONE" })).toBe("New message");
  });
  it("keeps the ordinary preview for ordinary chats", () => {
    expect(pushPreview({ secret: false, content: "see you at 5", mediaType: "NONE" })).toBe("see you at 5");
  });
  it("describes media the same way in both modes (media isn't encrypted)", () => {
    for (const secret of [true, false]) {
      expect(pushPreview({ secret, content: "", mediaType: "IMAGE" })).toBe("Sent a photo");
      expect(pushPreview({ secret, content: "", mediaType: "VIDEO" })).toBe("Sent a video");
      expect(pushPreview({ secret, content: "", mediaType: "GIF" })).toBe("Sent a GIF");
      expect(pushPreview({ secret, content: "", mediaType: "AUDIO" })).toBe("Sent a voice note");
    }
  });
});

describe("inboxPreview", () => {
  it("replaces ciphertext with a readable label", () => {
    expect(inboxPreview(CIPHERTEXT)).toBe("🔒 Secret message");
  });
  it("leaves ordinary text alone", () => {
    expect(inboxPreview("hi")).toBe("hi");
    expect(inboxPreview("")).toBe("");
  });
});
