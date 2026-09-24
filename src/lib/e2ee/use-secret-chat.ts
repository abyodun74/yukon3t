"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMyKeyBackup,
  getSecretChatState,
  resetEncryptionKeys,
  setSecretChat,
  setupEncryptionKeys,
} from "@/app/actions/e2ee";
import { E2EE_MIN_PASSPHRASE_LENGTH, isEncryptedContent } from "./constants";
import {
  decryptText,
  deriveConversationKey,
  encryptText,
  generateIdentity,
  keyFingerprint,
  securityCode,
  toNonExtractable,
  unwrapPrivateKey,
  wrapPrivateKey,
  type PublicJwk,
  type WrappedKey,
} from "./crypto";
import {
  clearIdentity,
  loadIdentity,
  loadPeerFingerprint,
  saveIdentity,
  savePeerFingerprint,
  type StoredIdentity,
} from "./key-store";

type ServerState = Extract<Awaited<ReturnType<typeof getSecretChatState>>, { eligible: true }>;

/**
 * Where this device stands for the current chat.
 *  - "loading":       still asking the server / checking this device.
 *  - "unavailable":   not a 1:1 chat (groups can't be secret), or couldn't load.
 *  - "no-keys":       this user has never set up encryption.
 *  - "needs-restore": they have, but this device doesn't hold the key yet.
 *  - "ready":         this device holds their key.
 */
type SecretPhase = "loading" | "unavailable" | "no-keys" | "needs-restore" | "ready";

const sameKey = (a: PublicJwk, b: PublicJwk) => a.x === b.x && a.y === b.y;

/**
 * Everything the chat screen needs for secret chats, for ONE conversation:
 * the server-side state (who has opted in), this device's key, the derived
 * conversation key, and encrypt/decrypt. It never sends plaintext anywhere,
 * and `encrypt` refuses (throws) rather than ever returning readable text.
 */
export function useSecretChat({
  conversationId,
  currentUserId,
  enabled,
}: {
  conversationId: string;
  currentUserId: string;
  /** False for group chats — nothing is loaded and the hook stays inert. */
  enabled: boolean;
}) {
  const [state, setState] = useState<ServerState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [identity, setIdentity] = useState<StoredIdentity | null>(null);
  const [identityChecked, setIdentityChecked] = useState(false);
  const [convKey, setConvKey] = useState<CryptoKey | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [peerKeyChanged, setPeerKeyChanged] = useState(false);
  const [version, setVersion] = useState(0);
  // ciphertext -> plaintext, or null when it could not be decrypted.
  const cache = useRef(new Map<string, string | null>());

  const applyState = useCallback((next: Awaited<ReturnType<typeof getSecretChatState>>) => {
    setState(next.error === null && next.eligible ? next : null);
    setLoaded(true);
  }, []);

  /** Re-reads who has opted in — after a toggle, and whenever the conversation's realtime signal fires. */
  const refresh = useCallback(async () => {
    if (!enabled) return;
    applyState(await getSecretChatState(conversationId));
  }, [conversationId, enabled, applyState]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void getSecretChatState(conversationId).then((next) => {
      if (!cancelled) applyState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId, enabled, applyState]);

  // Does this device hold the key the server has on file for me?
  const myPublicKey = state?.myPublicKey ?? null;
  useEffect(() => {
    if (!enabled || !state?.meHasKeys || !myPublicKey) return;
    let cancelled = false;
    void loadIdentity(currentUserId).then((stored) => {
      if (cancelled) return;
      const onFile = JSON.parse(myPublicKey) as PublicJwk;
      // A key from an older setup (before a reset) must not be used against the current public key.
      setIdentity(stored && sameKey(stored.publicJwk, onFile) ? stored : null);
      setIdentityChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, state?.meHasKeys, myPublicKey, currentUserId]);

  // Derive the conversation key, the security code, and notice a changed peer key.
  const peerPublicKey = state?.peerPublicKey ?? null;
  useEffect(() => {
    if (!enabled || !identity || !peerPublicKey) return;
    let cancelled = false;
    void (async () => {
      const peer = JSON.parse(peerPublicKey) as PublicJwk;
      const key = await deriveConversationKey(identity.privateKey, peer, conversationId);
      const shownCode = await securityCode(identity.publicJwk, peer);
      const fingerprint = await keyFingerprint(peer);
      const seen = await loadPeerFingerprint(currentUserId, conversationId);
      if (cancelled) return;
      cache.current.clear();
      setConvKey(key);
      setCode(shownCode);
      setPeerKeyChanged(seen !== null && seen !== fingerprint);
      if (seen === null) await savePeerFingerprint(currentUserId, conversationId, fingerprint);
      setVersion((v) => v + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, identity, peerPublicKey, conversationId, currentUserId]);

  const phase: SecretPhase = !enabled
    ? "unavailable"
    : !loaded
      ? "loading"
      : !state
        ? "unavailable"
        : !state.meHasKeys
          ? "no-keys"
          : !identityChecked
            ? "loading"
            : identity
              ? "ready"
              : "needs-restore";

  const active = Boolean(state?.active);
  const canEncrypt = active && convKey !== null;

  /** Encrypts for this chat. Throws — never falls back to plaintext — when it can't. */
  const encrypt = useCallback(
    async (text: string) => {
      if (!convKey || !active) throw new Error("secret_chat_unavailable");
      const wire = await encryptText(convKey, text, conversationId, currentUserId);
      // We already know what this says - remember it so the server's copy of our own message
      // shows instantly instead of flashing "Decrypting...".
      cache.current.set(wire, text);
      return wire;
    },
    [convKey, active, conversationId, currentUserId],
  );

  /** Decrypts any not-yet-seen ciphertext in the list into the cache; call whenever the messages change. */
  const prepare = useCallback(
    async (items: { content: string; senderId: string }[]) => {
      if (!convKey) return;
      let changed = false;
      await Promise.all(
        items.map(async ({ content, senderId }) => {
          if (!isEncryptedContent(content) || cache.current.has(content)) return;
          try {
            cache.current.set(content, await decryptText(convKey, content, conversationId, senderId));
          } catch {
            cache.current.set(content, null);
          }
          changed = true;
        }),
      );
      if (changed) setVersion((v) => v + 1);
    },
    [convKey, conversationId],
  );

  /** What to show for a stored message body: plaintext as-is, ciphertext decrypted (or a clear placeholder). */
  const display = useCallback(
    (content: string): string => {
      void version; // re-created when the cache changes, so memoised consumers re-render
      if (!isEncryptedContent(content)) return content;
      const hit = cache.current.get(content);
      if (hit === undefined) return "🔒 Decrypting…";
      if (hit === null) return "🔒 Couldn't decrypt this message";
      return hit;
    },
    [version],
  );

  const enable = useCallback(async () => {
    const result = await setSecretChat(conversationId, true);
    await refresh();
    return result;
  }, [conversationId, refresh]);

  const disable = useCallback(async () => {
    const result = await setSecretChat(conversationId, false);
    await refresh();
    return result;
  }, [conversationId, refresh]);

  /** First-time setup: makes a key pair, backs the private half up under the passphrase, keeps a non-extractable copy here. */
  const setup = useCallback(
    async (passphrase: string) => {
      if (passphrase.length < E2EE_MIN_PASSPHRASE_LENGTH) return { error: "too_short" as const };
      const { publicJwk, privateKey } = await generateIdentity();
      const wrapped = await wrapPrivateKey(privateKey, passphrase, currentUserId);
      const result = await setupEncryptionKeys(JSON.stringify(publicJwk), JSON.stringify(wrapped));
      if (result.error) return { error: result.error };
      const stored = { privateKey: await toNonExtractable(privateKey), publicJwk };
      await saveIdentity(currentUserId, stored);
      setIdentity(stored);
      setIdentityChecked(true);
      await refresh();
      return { error: null };
    },
    [currentUserId, refresh],
  );

  /** New device: fetch the encrypted backup and open it with the passphrase. */
  const restore = useCallback(
    async (passphrase: string) => {
      const backup = await getMyKeyBackup();
      if (backup.error !== null) return { error: backup.error };
      try {
        const { privateKey, publicJwk } = await unwrapPrivateKey(
          JSON.parse(backup.wrappedPrivateKey) as WrappedKey,
          passphrase,
          currentUserId,
        );
        if (!sameKey(publicJwk, JSON.parse(backup.publicKey) as PublicJwk)) return { error: "mismatch" as const };
        const stored = { privateKey, publicJwk };
        await saveIdentity(currentUserId, stored);
        setIdentity(stored);
        setIdentityChecked(true);
        return { error: null };
      } catch {
        return { error: "wrong_passphrase" as const };
      }
    },
    [currentUserId],
  );

  /** Forgot the passphrase: discards the keys (old encrypted messages become unreadable) so a new pair can be made. */
  const reset = useCallback(async () => {
    const result = await resetEncryptionKeys();
    if (result.error) return result;
    await clearIdentity(currentUserId);
    setIdentity(null);
    setIdentityChecked(false);
    setConvKey(null);
    setCode(null);
    cache.current.clear();
    await refresh();
    return { error: null };
  }, [currentUserId, refresh]);

  /** The user has compared security codes and accepts this contact's current key. */
  const acceptKeyChange = useCallback(async () => {
    if (!peerPublicKey) return;
    await savePeerFingerprint(currentUserId, conversationId, await keyFingerprint(JSON.parse(peerPublicKey) as PublicJwk));
    setPeerKeyChanged(false);
  }, [peerPublicKey, currentUserId, conversationId]);

  return {
    state,
    phase,
    active,
    canEncrypt,
    securityCode: code,
    peerKeyChanged,
    refresh,
    encrypt,
    prepare,
    display,
    enable,
    disable,
    setup,
    restore,
    reset,
    acceptKeyChange,
  };
}

export type SecretChat = ReturnType<typeof useSecretChat>;
