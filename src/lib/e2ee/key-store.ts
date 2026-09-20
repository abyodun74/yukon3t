"use client";

// This device's copy of the user's encryption identity, kept in IndexedDB.
//
// The private key is stored as a NON-extractable CryptoKey: the browser will
// use it (to derive conversation keys) but will never hand the raw bytes back
// to page script, so even an XSS bug can't copy it out — it can only ask the
// browser to use it while the page is open. That's the best a web app can do,
// and it is weaker than a key held in a phone's secure hardware; the FAQ says
// so. Clearing site data / reinstalling the app erases it — that's what the
// recovery passphrase is for.

import type { PublicJwk } from "./crypto";

const DB_NAME = "yukon3t-e2ee";
const DB_VERSION = 1;
const IDENTITY = "identity";
const PEERS = "peers";

export type StoredIdentity = { privateKey: CryptoKey; publicJwk: PublicJwk };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDENTITY)) db.createObjectStore(IDENTITY);
      if (!db.objectStoreNames.contains(PEERS)) db.createObjectStore(PEERS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Keyed by user id so two accounts signed in on one browser never share a key. */
export async function loadIdentity(userId: string): Promise<StoredIdentity | null> {
  try {
    return ((await run(IDENTITY, "readonly", (s) => s.get(userId))) as StoredIdentity | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function saveIdentity(userId: string, identity: StoredIdentity): Promise<void> {
  await run(IDENTITY, "readwrite", (s) => s.put(identity, userId));
}

export async function clearIdentity(userId: string): Promise<void> {
  await run(IDENTITY, "readwrite", (s) => s.delete(userId)).catch(() => {});
}

/**
 * The last key fingerprint this device saw for the person on the other end of
 * a conversation. If it later differs, their key changed — a new device, a
 * reset, or someone in the middle — and the chat warns (trust-on-first-use).
 */
export async function loadPeerFingerprint(userId: string, conversationId: string): Promise<string | null> {
  try {
    return ((await run(PEERS, "readonly", (s) => s.get(`${userId}:${conversationId}`))) as string | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function savePeerFingerprint(userId: string, conversationId: string, fingerprint: string): Promise<void> {
  await run(PEERS, "readwrite", (s) => s.put(fingerprint, `${userId}:${conversationId}`)).catch(() => {});
}
