"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { getBlockedEitherWayIds } from "@/lib/blocks";
import { getHiddenPeerIds } from "@/lib/hidden-chats";
import { giftsEnabledFor } from "@/lib/gifts";
import { foldForSearch } from "@/lib/gift-market";
import { loadReceivedGifts, loadSentGifts, type ReceivedGiftEntry, type SentGiftEntry } from "@/lib/gift-history";
import { giftMarketQuerySchema, giftMarketSkuSchema } from "@/lib/validations";

// The gift marketplace's own actions (pages: src/app/gift-marketplace; pure rules: src/lib/gift-market.ts). Sending is
// NOT here: it is createGiftIntent (app/actions/gifts.ts), the one paid-gift path, which re-checks everything. Every
// action re-derives the user from the session and refuses unless giftsEnabledFor says gifts are on for them.

/** Marks (or unmarks) a marketplace gift as a favorite. Idempotent: it takes the wanted state. */
export async function setGiftFavorite(
  productSku: string,
  favorite: boolean,
): Promise<{ error: "disabled" | "invalid" | "rate_limited" | null }> {
  const user = await requireVerifiedUser();
  if (!giftsEnabledFor(user)) return { error: "disabled" };
  const sku = giftMarketSkuSchema.safeParse(productSku);
  if (!sku.success || typeof favorite !== "boolean") return { error: "invalid" };
  if (!(await checkRateLimit("giftOpen", user.id))) return { error: "rate_limited" };
  const product = await prisma.giftProduct.findFirst({
    where: { sku: sku.data, category: { not: null } },
    select: { id: true },
  });
  if (!product) return { error: "invalid" };
  if (favorite) {
    await prisma.giftFavorite.upsert({
      where: { userId_productId: { userId: user.id, productId: product.id } },
      create: { userId: user.id, productId: product.id },
      update: {},
      select: { id: true },
    });
  } else {
    await prisma.giftFavorite.deleteMany({ where: { userId: user.id, productId: product.id } });
  }
  revalidatePath("/gift-marketplace");
  return { error: null };
}

export type GiftRecipientOption = { id: string; name: string | null; username: string | null; avatarUrl: string | null };

/**
 * People the user could pick to send a gift to: the people they recently sent one to and their accepted connections,
 * optionally narrowed by a name / username search (within those, never a global directory). Left out: themselves,
 * anyone blocked either way, hidden-chat peers (never offered, like every share picker), inactive and guest accounts,
 * and anyone gifts aren't on for. Whether a gift would actually land (age, the person's giftsFrom) is checked when
 * one is picked (checkGiftRecipient) and again by the send.
 */
export async function searchGiftRecipients(
  query: string,
): Promise<{ error: "disabled" | "invalid" | "rate_limited" } | { error: null; recent: GiftRecipientOption[]; connections: GiftRecipientOption[] }> {
  const user = await requireVerifiedUser();
  if (!giftsEnabledFor(user)) return { error: "disabled" };
  const parsed = giftMarketQuerySchema.safeParse(query ?? "");
  if (!parsed.success) return { error: "invalid" };
  if (!(await checkRateLimit("giftCatalog", user.id))) return { error: "rate_limited" };

  const personSelect = {
    id: true,
    name: true,
    username: true,
    avatarUrl: true,
    status: true,
    isAdmin: true,
    isGuestPreview: true,
  } as const;
  const [blocked, hiddenPeers, sent, accepted] = await Promise.all([
    getBlockedEitherWayIds(user.id),
    getHiddenPeerIds(user.id),
    prisma.giftSend.findMany({
      where: { senderId: user.id },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { recipient: { select: personSelect } },
    }),
    prisma.connection.findMany({
      where: { status: "ACCEPTED", OR: [{ requesterId: user.id }, { targetId: user.id }] },
      orderBy: { respondedAt: "desc" },
      take: 300,
      select: { requesterId: true, requester: { select: personSelect }, target: { select: personSelect } },
    }),
  ]);
  const excluded = new Set<string>([user.id, ...blocked, ...hiddenPeers]);
  const words = foldForSearch(parsed.data).split(/\s+/).filter(Boolean);
  type Person = { id: string; name: string | null; username: string | null; avatarUrl: string | null; status: string; isAdmin: boolean; isGuestPreview: boolean };
  const eligible = (p: Person) =>
    !excluded.has(p.id) &&
    p.status === "ACTIVE" &&
    giftsEnabledFor(p) &&
    words.every((w) => foldForSearch(`${p.name ?? ""} ${p.username ?? ""}`).includes(w));
  const view = (p: Person): GiftRecipientOption => ({ id: p.id, name: p.name, username: p.username, avatarUrl: p.avatarUrl });

  const seen = new Set<string>();
  const recent: GiftRecipientOption[] = [];
  for (const { recipient } of sent) {
    if (recent.length >= 8 || seen.has(recipient.id) || !eligible(recipient)) continue;
    seen.add(recipient.id);
    recent.push(view(recipient));
  }
  const connections: GiftRecipientOption[] = [];
  for (const row of accepted) {
    const other = row.requesterId === user.id ? row.target : row.requester;
    if (connections.length >= 100 || seen.has(other.id) || !eligible(other)) continue;
    seen.add(other.id);
    connections.push(view(other));
  }
  return { error: null, recent, connections };
}

/** The signed-in person's gift history (most recent GIFT_HISTORY_LIMIT), sent or received. */
export async function getGiftHistory(
  tab: "sent" | "received",
): Promise<
  | { error: "disabled" | "invalid" | "rate_limited" }
  | { error: null; tab: "sent"; sent: SentGiftEntry[] }
  | { error: null; tab: "received"; received: ReceivedGiftEntry[] }
> {
  const user = await requireVerifiedUser();
  if (!giftsEnabledFor(user)) return { error: "disabled" };
  if (tab !== "sent" && tab !== "received") return { error: "invalid" };
  if (!(await checkRateLimit("giftCatalog", user.id))) return { error: "rate_limited" };
  return tab === "sent"
    ? { error: null, tab, sent: await loadSentGifts(user.id) }
    : { error: null, tab, received: await loadReceivedGifts(user.id) };
}
