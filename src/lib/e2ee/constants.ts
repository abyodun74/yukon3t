// Shared by the browser (encrypt/decrypt) and the server (which never sees
// plaintext in a secret chat, but validates that what it stores is shaped like
// ciphertext and never a stray plaintext message). Nothing secret lives here.

/** Every encrypted message body starts with this, so ciphertext is recognisable at a glance and versioned. */
export const E2EE_PREFIX = "e2ee:v1:";

/**
 * PBKDF2-HMAC-SHA256 iterations for the recovery-passphrase key (OWASP's 2023
 * floor for PBKDF2-SHA256). This is the only thing standing between a copy of
 * the stored key backup and an offline guessing attack, so it's deliberately
 * slow: about half a second on a laptop, a few seconds on an old phone — paid
 * once at setup and once per restore.
 */
export const E2EE_PBKDF2_ITERATIONS = 600_000;

/** A long passphrase is the real protection here — see E2EE_PBKDF2_ITERATIONS. */
export const E2EE_MIN_PASSPHRASE_LENGTH = 12;

/**
 * Message.content is capped at 4000 characters (messageSchema) and ciphertext
 * is ~4/3 the size of the plaintext plus a small header, so a secret-chat
 * message is limited to what still fits after encoding. Counted in UTF-8
 * bytes, not characters, since that's what actually gets encrypted.
 */
export const E2EE_MAX_PLAINTEXT_BYTES = 2900;

export function isEncryptedContent(content: string): boolean {
  return content.startsWith(E2EE_PREFIX);
}

// e2ee:v1:<12-byte IV as base64url = 16 chars>:<ciphertext + 16-byte GCM tag as
// base64url, so at least 22 chars>. This checks the SHAPE only — the server
// can't tell real ciphertext from random base64, and doesn't need to: it only
// has to stop accidental plaintext, and a client that wants to send junk can
// already do that in any chat.
const WELL_FORMED = /^e2ee:v1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22,}$/;

export function isWellFormedEncryptedContent(content: string): boolean {
  return WELL_FORMED.test(content);
}
