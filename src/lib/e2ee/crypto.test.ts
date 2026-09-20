import { describe, expect, it } from "vitest";
import {
  decryptText,
  deriveConversationKey,
  encryptText,
  generateIdentity,
  keyFingerprint,
  securityCode,
  toNonExtractable,
  unwrapPrivateKey,
  utf8ByteLength,
  wrapPrivateKey,
} from "./crypto";
import { E2EE_MAX_PLAINTEXT_BYTES, E2EE_PREFIX, isEncryptedContent, isWellFormedEncryptedContent } from "./constants";

// Small iteration count only to keep the suite fast — the production default (600k) is a constant, not logic.
const FAST = 1000;

async function pair() {
  const a = await generateIdentity();
  const b = await generateIdentity();
  return { a, b };
}

describe("conversation key agreement", () => {
  it("both participants derive the same key, so what A encrypts B decrypts", async () => {
    const { a, b } = await pair();
    const keyA = await deriveConversationKey(a.privateKey, b.publicJwk, "conv1");
    const keyB = await deriveConversationKey(b.privateKey, a.publicJwk, "conv1");

    const ct = await encryptText(keyA, "hello Bola 👋", "conv1", "userA");
    expect(await decryptText(keyB, ct, "conv1", "userA")).toBe("hello Bola 👋");

    // and the other direction
    const ct2 = await encryptText(keyB, "hi back", "conv1", "userB");
    expect(await decryptText(keyA, ct2, "conv1", "userB")).toBe("hi back");
  });

  it("gives each conversation its own key from the same identity keys", async () => {
    const { a, b } = await pair();
    const k1 = await deriveConversationKey(a.privateKey, b.publicJwk, "conv1");
    const k2 = await deriveConversationKey(a.privateKey, b.publicJwk, "conv2");
    const ct = await encryptText(k1, "secret", "conv1", "userA");
    await expect(decryptText(k2, ct, "conv1", "userA")).rejects.toThrow("decrypt_failed");
  });

  it("a third party with their own key can't read it", async () => {
    const { a, b } = await pair();
    const eve = await generateIdentity();
    const ct = await encryptText(await deriveConversationKey(a.privateKey, b.publicJwk, "c"), "secret", "c", "userA");
    const eveKey = await deriveConversationKey(eve.privateKey, b.publicJwk, "c");
    await expect(decryptText(eveKey, ct, "c", "userA")).rejects.toThrow("decrypt_failed");
  });
});

describe("message encryption", () => {
  it("never contains the plaintext, and is different every time (fresh IV)", async () => {
    const { a, b } = await pair();
    const key = await deriveConversationKey(a.privateKey, b.publicJwk, "c");
    const one = await encryptText(key, "the same words", "c", "u");
    const two = await encryptText(key, "the same words", "c", "u");
    expect(one).not.toContain("same words");
    expect(one).not.toBe(two);
    expect(one.startsWith(E2EE_PREFIX)).toBe(true);
  });

  it("round-trips unicode, emoji and empty-ish edge cases", async () => {
    const { a, b } = await pair();
    const key = await deriveConversationKey(a.privateKey, b.publicJwk, "c");
    for (const text of ["ẹ ṣé", "日本語のメッセージ", "😀🔥🇳🇬", " ", "a".repeat(2900)]) {
      expect(await decryptText(key, await encryptText(key, text, "c", "u"), "c", "u")).toBe(text);
    }
  });

  it("is bound to the conversation and sender: replaying it elsewhere or as someone else fails", async () => {
    const { a, b } = await pair();
    const key = await deriveConversationKey(a.privateKey, b.publicJwk, "convX");
    const ct = await encryptText(key, "pay Bola", "convX", "alice");
    await expect(decryptText(key, ct, "convY", "alice")).rejects.toThrow("decrypt_failed"); // moved to another chat
    await expect(decryptText(key, ct, "convX", "mallory")).rejects.toThrow("decrypt_failed"); // attributed to someone else
  });

  it("detects tampering with any part of the ciphertext", async () => {
    const { a, b } = await pair();
    const key = await deriveConversationKey(a.privateKey, b.publicJwk, "c");
    const ct = await encryptText(key, "transfer 100", "c", "u");
    const flipLast = ct.slice(0, -2) + (ct.endsWith("A") ? "B" : "A") + ct.slice(-1);
    await expect(decryptText(key, flipLast, "c", "u")).rejects.toThrow("decrypt_failed");
    await expect(decryptText(key, ct.slice(0, -4), "c", "u")).rejects.toThrow("decrypt_failed"); // truncated
    await expect(decryptText(key, "e2ee:v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA", "c", "u")).rejects.toThrow("decrypt_failed");
    await expect(decryptText(key, "just plain text", "c", "u")).rejects.toThrow("decrypt_failed");
  });

  it("produces content the server's shape check accepts, and rejects plaintext", async () => {
    const { a, b } = await pair();
    const key = await deriveConversationKey(a.privateKey, b.publicJwk, "c");
    expect(isWellFormedEncryptedContent(await encryptText(key, "hi", "c", "u"))).toBe(true);
    expect(isWellFormedEncryptedContent("hello there")).toBe(false);
    expect(isWellFormedEncryptedContent("e2ee:v1:short")).toBe(false);
    expect(isEncryptedContent("e2ee:v1:whatever")).toBe(true);
  });

  it("keeps a maximum-length message inside the 4000-character column", async () => {
    const { a, b } = await pair();
    const key = await deriveConversationKey(a.privateKey, b.publicJwk, "c");
    const worst = await encryptText(key, "a".repeat(E2EE_MAX_PLAINTEXT_BYTES), "c", "u");
    expect(worst.length).toBeLessThanOrEqual(4000);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("😀")).toBe(4);
  });
});

describe("passphrase-protected key backup", () => {
  it("restores the same identity with the right passphrase", async () => {
    const { a, b } = await pair();
    const wrapped = await wrapPrivateKey(a.privateKey, "correct horse battery", "userA", FAST);
    const restored = await unwrapPrivateKey(wrapped, "correct horse battery", "userA");

    expect(restored.publicJwk).toEqual(a.publicJwk);
    // The restored key derives the same conversation key as the original.
    const original = await deriveConversationKey(a.privateKey, b.publicJwk, "c");
    const again = await deriveConversationKey(restored.privateKey, b.publicJwk, "c");
    const ct = await encryptText(original, "from before the restore", "c", "userA");
    expect(await decryptText(again, ct, "c", "userA")).toBe("from before the restore");
  });

  it("refuses a wrong passphrase", async () => {
    const { a } = await pair();
    const wrapped = await wrapPrivateKey(a.privateKey, "correct horse battery", "userA", FAST);
    await expect(unwrapPrivateKey(wrapped, "correct horse batterX", "userA")).rejects.toThrow("wrong_passphrase");
  });

  it("refuses a backup that belongs to a different user", async () => {
    const { a } = await pair();
    const wrapped = await wrapPrivateKey(a.privateKey, "correct horse battery", "userA", FAST);
    await expect(unwrapPrivateKey(wrapped, "correct horse battery", "userB")).rejects.toThrow("wrong_passphrase");
  });

  it("does not store the private key or passphrase in the blob", async () => {
    const { a } = await pair();
    const wrapped = await wrapPrivateKey(a.privateKey, "correct horse battery", "userA", FAST);
    const json = JSON.stringify(wrapped);
    expect(json).not.toContain("correct horse");
    expect(Object.keys(wrapped).sort()).toEqual(["ct", "iter", "iv", "salt", "v"]);
  });

  it("treats the same passphrase typed with different unicode forms as equal (NFKC)", async () => {
    const { a } = await pair();
    const composed = "café-secret-phrase"; // é as one code point
    const decomposed = "café-secret-phrase"; // e + combining accent
    const wrapped = await wrapPrivateKey(a.privateKey, composed, "userA", FAST);
    await expect(unwrapPrivateKey(wrapped, decomposed, "userA")).resolves.toBeDefined();
  });

  it("hands back a key that page script can't read out (non-extractable)", async () => {
    const { a } = await pair();
    const wrapped = await wrapPrivateKey(a.privateKey, "correct horse battery", "userA", FAST);
    const { privateKey } = await unwrapPrivateKey(wrapped, "correct horse battery", "userA");
    await expect(globalThis.crypto.subtle.exportKey("pkcs8", privateKey)).rejects.toThrow();
    const local = await toNonExtractable(a.privateKey);
    await expect(globalThis.crypto.subtle.exportKey("pkcs8", local)).rejects.toThrow();
  });

  it("the public key never carries the private scalar", async () => {
    const { a } = await pair();
    expect(Object.keys(a.publicJwk).sort()).toEqual(["crv", "kty", "x", "y"]);
  });
});

describe("security code", () => {
  it("is identical on both phones regardless of who computes it", async () => {
    const { a, b } = await pair();
    const one = await securityCode(a.publicJwk, b.publicJwk);
    const two = await securityCode(b.publicJwk, a.publicJwk);
    expect(one).toBe(two);
    expect(one).toMatch(/^\d{5}( \d{5}){5}$/);
  });

  it("changes when either key is swapped for another", async () => {
    const { a, b } = await pair();
    const mallory = await generateIdentity();
    expect(await securityCode(a.publicJwk, b.publicJwk)).not.toBe(await securityCode(a.publicJwk, mallory.publicJwk));
  });

  it("fingerprints are stable per key and differ between keys", async () => {
    const { a, b } = await pair();
    expect(await keyFingerprint(a.publicJwk)).toBe(await keyFingerprint(a.publicJwk));
    expect(await keyFingerprint(a.publicJwk)).not.toBe(await keyFingerprint(b.publicJwk));
  });
});
