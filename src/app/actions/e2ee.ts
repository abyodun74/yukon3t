"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { isBlockedEitherWay } from "@/lib/blocks";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { publishEvent } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { E2EE_PBKDF2_ITERATIONS } from "@/lib/e2ee/constants";
import { isSecretChat } from "@/lib/e2ee/secret-chat";

// Secret chats: end-to-end encrypted text between two people who both opted in.
// The encryption itself happens entirely in the browsers (src/lib/e2ee/crypto.ts);
// everything in this file is bookkeeping the server CAN do without ever seeing
// a message: hold each person's PUBLIC key and their passphrase-encrypted
// private-key backup, remember who has opted in, and refuse to store plaintext
// in a chat that's secret (see sendMessage in messages.ts).

const b64url = z.string().regex(/^[A-Za-z0-9_-]+$/);

// An uncompressed P-256 point: two 32-byte coordinates = 43 base64url chars each.
const publicKeySchema = z
  .object({ kty: z.literal("EC"), crv: z.literal("P-256"), x: b64url.length(43), y: b64url.length(43) })
  .strict();

// salt 16 bytes -> 22 chars, IV 12 bytes -> 16 chars, PKCS8 P-256 key + GCM tag ~ 154 bytes -> ~206 chars.
const wrappedKeySchema = z
  .object({
    v: z.literal(1),
    salt: b64url.length(22),
    iv: b64url.length(16),
    iter: z.number().int().min(E2EE_PBKDF2_ITERATIONS).max(10_000_000),
    ct: b64url.min(120).max(400),
  })
  .strict();

/** The server can't tell a real curve point from two valid-looking strings — ask the crypto library. */
async function isRealP256Point(jwk: z.infer<typeof publicKeySchema>): Promise<boolean> {
  try {
    await globalThis.crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
    return true;
  } catch {
    return false;
  }
}

async function conversationForMember(conversationId: string, userId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      isGroup: true,
      members: {
        select: { userId: true, e2eeEnabledAt: true, user: { select: { id: true, name: true, encryptionKey: { select: { publicKey: true } } } } },
      },
    },
  });
  if (!conversation || !conversation.members.some((m) => m.userId === userId)) return null;
  return conversation;
}

/**
 * Everything the chat screen needs to decide what to show and how to encrypt.
 * The peer's public key is only ever returned to someone who is in a
 * conversation with them.
 */
export async function getSecretChatState(conversationId: string) {
  const user = await requireVerifiedUser();
  const conversation = await conversationForMember(conversationId, user.id);
  if (!conversation) return { error: "not_found" as const };

  const me = conversation.members.find((m) => m.userId === user.id)!;
  const peer = conversation.members.find((m) => m.userId !== user.id);
  // Secret chats are 1:1 only.
  if (conversation.isGroup || !peer) {
    return { error: null, eligible: false as const, userId: user.id };
  }

  return {
    error: null,
    eligible: true as const,
    userId: user.id,
    peer: { id: peer.user.id, name: peer.user.name },
    meHasKeys: Boolean(me.user.encryptionKey),
    myPublicKey: me.user.encryptionKey?.publicKey ?? null,
    peerHasKeys: Boolean(peer.user.encryptionKey),
    peerPublicKey: peer.user.encryptionKey?.publicKey ?? null,
    meEnabled: me.e2eeEnabledAt !== null,
    peerEnabled: peer.e2eeEnabledAt !== null,
    active: isSecretChat(conversation),
  };
}

/**
 * Stores this user's public key and their passphrase-encrypted private-key
 * backup. Set once: replacing a key would strand every conversation that
 * used the old one, so changing it is the deliberate resetEncryptionKeys()
 * path, never a silent overwrite.
 */
export async function setupEncryptionKeys(publicKeyJson: string, wrappedPrivateKeyJson: string) {
  const user = await requireVerifiedUser();

  if (!(await checkRateLimit("e2eeSetup", user.id))) return { error: "rate_limited" as const };

  let publicKey: z.infer<typeof publicKeySchema>;
  let wrapped: z.infer<typeof wrappedKeySchema>;
  try {
    publicKey = publicKeySchema.parse(JSON.parse(publicKeyJson));
    wrapped = wrappedKeySchema.parse(JSON.parse(wrappedPrivateKeyJson));
  } catch {
    return { error: "invalid" as const };
  }
  if (!(await isRealP256Point(publicKey))) return { error: "invalid" as const };

  try {
    await prisma.userEncryptionKey.create({
      data: {
        userId: user.id,
        // Re-serialised from the validated objects, in a fixed key order, so
        // nothing extra a client tacked on is ever stored or served to others.
        publicKey: JSON.stringify({ kty: publicKey.kty, crv: publicKey.crv, x: publicKey.x, y: publicKey.y }),
        wrappedPrivateKey: JSON.stringify({ v: wrapped.v, salt: wrapped.salt, iv: wrapped.iv, iter: wrapped.iter, ct: wrapped.ct }),
      },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) return { error: "already_setup" as const };
    throw err;
  }
  return { error: null };
}

/** For restoring on a new device. Returns the passphrase-encrypted blob — useless without the passphrase. */
export async function getMyKeyBackup() {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("e2eeBackupFetch", user.id))) return { error: "rate_limited" as const };

  const row = await prisma.userEncryptionKey.findUnique({ where: { userId: user.id } });
  if (!row) return { error: "no_keys" as const };
  return { error: null, publicKey: row.publicKey, wrappedPrivateKey: row.wrappedPrivateKey };
}

/**
 * "I forgot my passphrase": deletes the stored keys so a new pair can be set
 * up. The cost is real and the UI says so: messages sent under the old key
 * can't be read by either person afterward. Every secret chat this person was
 * in is switched off (the other side is left opted in, but the conversation is
 * only secret while BOTH are).
 */
export async function resetEncryptionKeys() {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("e2eeReset", user.id))) return { error: "rate_limited" as const };

  const affected = await prisma.conversationMember.findMany({
    where: { userId: user.id, e2eeEnabledAt: { not: null } },
    select: { conversationId: true },
  });
  await prisma.$transaction([
    prisma.conversationMember.updateMany({ where: { userId: user.id, e2eeEnabledAt: { not: null } }, data: { e2eeEnabledAt: null } }),
    prisma.userEncryptionKey.deleteMany({ where: { userId: user.id } }),
  ]);
  await Promise.all(affected.map((c) => publishEvent(REALTIME_CHANNELS.conversation(c.conversationId), "changed")));
  revalidatePath("/messages");
  return { error: null };
}

/** Turn secret chat on or off for MY side. It becomes active only once the other person has turned theirs on too. */
export async function setSecretChat(conversationId: string, enabled: boolean) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("e2eeToggle", user.id))) return { error: "rate_limited" as const };

  const conversation = await conversationForMember(conversationId, user.id);
  if (!conversation) return { error: "not_found" as const };
  const peer = conversation.members.find((m) => m.userId !== user.id);
  if (conversation.isGroup || !peer) return { error: "not_supported" as const };
  if (await isBlockedEitherWay(user.id, peer.userId)) return { error: "blocked" as const };

  const me = conversation.members.find((m) => m.userId === user.id)!;
  if (enabled && !me.user.encryptionKey) return { error: "no_keys" as const };

  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId: user.id } },
    data: { e2eeEnabledAt: enabled ? (me.e2eeEnabledAt ?? new Date()) : null },
  });
  await publishEvent(REALTIME_CHANNELS.conversation(conversationId), "changed");
  revalidatePath(`/messages/${conversationId}`);

  const peerEnabled = peer.e2eeEnabledAt !== null;
  return { error: null, meEnabled: enabled, peerEnabled, active: enabled && peerEnabled };
}
