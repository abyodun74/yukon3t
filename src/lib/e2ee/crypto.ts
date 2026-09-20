// End-to-end encryption primitives for secret chats — the browser's built-in
// Web Crypto only (no third-party crypto code), so this is small enough to
// read and review in one sitting. Runs unchanged in Node (>= 20) for tests.
//
// The scheme:
//  - Each user has ONE long-lived ECDH P-256 identity key pair.
//  - For a conversation, both people derive the same 256-bit AES-GCM key:
//      shared  = ECDH(myPrivate, theirPublic)
//      convKey = HKDF-SHA256(shared, salt = conversationId, info = "yukon3t-secret-chat-v1")
//    (ECDH is symmetric, so A and B land on the same key; the conversationId
//    salt gives every conversation its own key from the same identity keys.)
//  - Each message is AES-256-GCM with a fresh random 96-bit IV and AAD bound
//    to (conversationId, senderId), so a ciphertext can't be replayed into a
//    different conversation or attributed to a different sender.
//  - The private key is backed up encrypted under a key derived from the
//    user's recovery passphrase (PBKDF2-SHA256 -> AES-256-GCM).
//
// What this does NOT give you (documented in SECURITY.md and the FAQ): forward
// secrecy — the identity key is long-lived, so someone who gets a device's key
// can read that chat's stored history — and protection from the server handing
// out a substituted public key, which is what the "security code" is for.

import { E2EE_PBKDF2_ITERATIONS, E2EE_PREFIX, isEncryptedContent } from "./constants";

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

export type PublicJwk = { kty: "EC"; crv: "P-256"; x: string; y: string };
export type WrappedKey = { v: 1; salt: string; iv: string; iter: number; ct: string };

// ---------- base64url ----------
export function toB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64Url(s: string): Uint8Array<ArrayBuffer> {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function utf8ByteLength(s: string): number {
  return enc.encode(s).length;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));
}

// ---------- identity keys ----------
function toPublicJwk(jwk: JsonWebKey): PublicJwk {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) throw new Error("not_a_p256_public_key");
  // Only the public coordinates — never carry `d` (the private scalar) along.
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}

/** A fresh identity. The private key is extractable ONLY so it can be wrapped for backup; store a non-extractable copy locally. */
export async function generateIdentity(): Promise<{ publicJwk: PublicJwk; privateKey: CryptoKey }> {
  const pair = await subtle().generateKey(ECDH, true, ["deriveBits"]);
  return { publicJwk: toPublicJwk(await subtle().exportKey("jwk", pair.publicKey)), privateKey: pair.privateKey };
}

/** Re-imports a private key as NON-extractable, for storage on the device: the raw key can then never be read back out by page script. */
export async function toNonExtractable(privateKey: CryptoKey): Promise<CryptoKey> {
  const pkcs8 = await subtle().exportKey("pkcs8", privateKey);
  return subtle().importKey("pkcs8", pkcs8, ECDH, false, ["deriveBits"]);
}

// ---------- passphrase backup ----------
async function passphraseKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  // NFKC so the same passphrase typed on different keyboards/IMEs derives the same key.
  const base = await subtle().importKey("raw", enc.encode(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const backupAad = (userId: string) => enc.encode(`yukon3t:e2ee:v1:backup:${userId}`);

/** Encrypts the private key under the passphrase. The result is safe to store on the server: without the passphrase it's opaque. */
export async function wrapPrivateKey(
  privateKey: CryptoKey,
  passphrase: string,
  userId: string,
  iterations: number = E2EE_PBKDF2_ITERATIONS,
): Promise<WrappedKey> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await passphraseKey(passphrase, salt, iterations);
  const pkcs8 = await subtle().exportKey("pkcs8", privateKey);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: backupAad(userId) }, key, pkcs8);
  return { v: 1, salt: toB64Url(salt), iv: toB64Url(iv), iter: iterations, ct: toB64Url(new Uint8Array(ct)) };
}

/** Throws "wrong_passphrase" on a bad passphrase or a blob that isn't this user's — AES-GCM can't tell those apart, and shouldn't. */
export async function unwrapPrivateKey(
  wrapped: WrappedKey,
  passphrase: string,
  userId: string,
): Promise<{ privateKey: CryptoKey; publicJwk: PublicJwk }> {
  let pkcs8: ArrayBuffer;
  try {
    const key = await passphraseKey(passphrase, fromB64Url(wrapped.salt), wrapped.iter);
    pkcs8 = await subtle().decrypt(
      { name: "AES-GCM", iv: fromB64Url(wrapped.iv), additionalData: backupAad(userId) },
      key,
      fromB64Url(wrapped.ct),
    );
  } catch {
    throw new Error("wrong_passphrase");
  }
  // Import once extractable just to read out the public half, then keep only a non-extractable copy.
  const temp = await subtle().importKey("pkcs8", pkcs8, ECDH, true, ["deriveBits"]);
  const publicJwk = toPublicJwk(await subtle().exportKey("jwk", temp));
  const privateKey = await subtle().importKey("pkcs8", pkcs8, ECDH, false, ["deriveBits"]);
  return { privateKey, publicJwk };
}

// ---------- per-conversation key + messages ----------
/** Both participants call this with their own private key and the other's public key and get the SAME key. */
export async function deriveConversationKey(
  myPrivateKey: CryptoKey,
  peerPublicJwk: PublicJwk,
  conversationId: string,
): Promise<CryptoKey> {
  const peer = await subtle().importKey("jwk", peerPublicJwk, ECDH, false, []);
  const shared = await subtle().deriveBits({ name: "ECDH", public: peer }, myPrivateKey, 256);
  const hkdf = await subtle().importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode(conversationId), info: enc.encode("yukon3t-secret-chat-v1") },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const messageAad = (conversationId: string, senderId: string) =>
  enc.encode(`yukon3t:e2ee:v1:msg:${conversationId}:${senderId}`);

export async function encryptText(key: CryptoKey, plaintext: string, conversationId: string, senderId: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv, additionalData: messageAad(conversationId, senderId) },
    key,
    enc.encode(plaintext),
  );
  return `${E2EE_PREFIX}${toB64Url(iv)}:${toB64Url(new Uint8Array(ct))}`;
}

/** Throws "decrypt_failed" on anything that isn't a valid message for exactly this conversation and sender. */
export async function decryptText(key: CryptoKey, content: string, conversationId: string, senderId: string): Promise<string> {
  try {
    if (!isEncryptedContent(content)) throw new Error("not_encrypted");
    const [ivPart, ctPart] = content.slice(E2EE_PREFIX.length).split(":");
    const pt = await subtle().decrypt(
      { name: "AES-GCM", iv: fromB64Url(ivPart), additionalData: messageAad(conversationId, senderId) },
      key,
      fromB64Url(ctPart),
    );
    return dec.decode(pt);
  } catch {
    throw new Error("decrypt_failed");
  }
}

// ---------- security code ----------
/**
 * A short code derived from BOTH people's public keys, identical on both
 * phones. If they read it out to each other (or compare in person) and it
 * matches, nobody — including this server — swapped a key in between.
 * 6 groups of 5 digits.
 */
export async function securityCode(a: PublicJwk, b: PublicJwk): Promise<string> {
  const canon = (k: PublicJwk) => `${k.x}.${k.y}`;
  const [first, second] = [canon(a), canon(b)].sort();
  const digest = new Uint8Array(await subtle().digest("SHA-256", enc.encode(`yukon3t:e2ee:v1:code:${first}|${second}`)));
  const groups: string[] = [];
  for (let i = 0; i < 6; i++) {
    const n = (digest[3 * i] << 16) | (digest[3 * i + 1] << 8) | digest[3 * i + 2];
    groups.push(String(n % 100000).padStart(5, "0"));
  }
  return groups.join(" ");
}

/** Stable identifier for one key — used to notice when a contact's key changes. */
export async function keyFingerprint(k: PublicJwk): Promise<string> {
  const digest = new Uint8Array(await subtle().digest("SHA-256", enc.encode(`${k.x}.${k.y}`)));
  return toB64Url(digest.slice(0, 16));
}
