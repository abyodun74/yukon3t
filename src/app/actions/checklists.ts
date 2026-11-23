"use server";

import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { isBlockedEitherWay } from "@/lib/blocks";
import { isSecretChat } from "@/lib/e2ee/secret-chat";
import { isMembershipLocked } from "@/lib/hidden-chats";
import { collabChatHiddenFor } from "@/lib/collab-chat-visibility-server";
import { publishEvent } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { checklistItemTextSchema } from "@/lib/validations";
import {
  CHECKLIST_SELECT,
  canAddChecklistItem,
  checklistLockKey,
  cleanShoppingListItem,
  type ChecklistData,
} from "@/lib/shopping-list";
import { z } from "zod";

/*
 * Shared checklist messages (the chat composer's "Shopping list"; pure rules in src/lib/shopping-list.ts). A checklist
 * is created by sendMessage like any message; these change it afterwards. Any current member of the chat can tick,
 * untick, add, rewrite and remove rows, not only the sender.
 *
 * Every action, before touching anything:
 *  - re-derives the actor from the session (requireVerifiedUser) and validates its input with Zod;
 *  - takes the shared `checklistChange` limiter;
 *  - finds the list through the row or list id and checks the actor is a member of that message's chat, answering a
 *    collab chat hidden from them by a block exactly like a chat they are not in (not_found), before the hidden-chat
 *    lock (hidden_locked) so the two can't be told apart;
 *  - refuses a message that is gone for them (deleted for everyone, deleted for them, held or removed by moderation);
 *  - in a 1:1, refuses while either person blocks the other (blocked), like sendMessage;
 *  - never writes readable text into a secret (E2EE) chat: a list sent before the chat became secret can still be
 *    ticked, unticked and trimmed, but not given new text (not_supported_in_secret_chat; the bubble doesn't offer it);
 *  - does not scan new or rewritten text: it is chat text, which is not scanned automatically (it can be reported).
 * Then it writes with a guarded statement (a tick only lands on an unticked row and the other way round, every write is
 * scoped to the list it was checked against, adding takes a per-list advisory lock for the count and position), tells
 * open threads through the conversation's realtime signal, and answers the whole list as it now stands.
 */

const idSchema = z.string().cuid();

type ChecklistError =
  | "invalid"
  | "rate_limited"
  | "not_found"
  | "hidden_locked"
  | "blocked"
  | "not_supported_in_secret_chat"
  | "full";

type ChecklistResult = { error: ChecklistError; checklist?: undefined } | { error: null; checklist: ChecklistData };

type Access = { checklistId: string; conversationId: string; secret: boolean; userId: string };

/** The access checks shared by every action (see the header). `checklistId` is from the client and checked here. */
async function checklistAccess(userId: string, checklistId: string): Promise<Access | { error: ChecklistError }> {
  const checklist = await prisma.checklistMessage.findUnique({
    where: { id: checklistId },
    select: {
      id: true,
      message: {
        select: {
          conversationId: true,
          deletedForEveryoneAt: true,
          deletedForUserIds: true,
          moderationStatus: true,
          conversation: { select: { isGroup: true, members: { select: { userId: true, e2eeEnabledAt: true } } } },
        },
      },
    },
  });
  if (!checklist) return { error: "not_found" };
  const { message } = checklist;
  const conversationId = message.conversationId;
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!membership || (await collabChatHiddenFor(userId, conversationId))) return { error: "not_found" };
  if (await isMembershipLocked(membership, userId)) return { error: "hidden_locked" };
  if (message.deletedForEveryoneAt || message.deletedForUserIds.includes(userId) || message.moderationStatus !== "PUBLISHED") {
    return { error: "not_found" };
  }
  if (!message.conversation.isGroup) {
    const other = message.conversation.members.find((m) => m.userId !== userId);
    if (other && (await isBlockedEitherWay(userId, other.userId))) return { error: "blocked" };
  }
  return { checklistId: checklist.id, conversationId, secret: isSecretChat(message.conversation), userId };
}

/** The row's list, for the actions that take a row id. */
async function checklistIdOfItem(itemId: string): Promise<string | null> {
  const item = await prisma.checklistItem.findUnique({ where: { id: itemId }, select: { checklistId: true } });
  return item?.checklistId ?? null;
}

async function start(userId: string, checklistId: string | null) {
  if (!checklistId) return { error: "not_found" as const };
  if (!(await checkRateLimit("checklistChange", userId))) return { error: "rate_limited" as const };
  return checklistAccess(userId, checklistId);
}

/** New or rewritten row text: cleaned like the editor does. Null text = invalid. */
async function checkedText(raw: unknown): Promise<{ text: string } | { error: ChecklistError }> {
  const parsed = checklistItemTextSchema.safeParse({ text: typeof raw === "string" ? cleanShoppingListItem(raw) : raw });
  if (!parsed.success) return { error: "invalid" };
  return { text: parsed.data.text };
}

async function finish(access: Access): Promise<ChecklistResult> {
  await publishEvent(REALTIME_CHANNELS.conversation(access.conversationId), "changed");
  const checklist = await prisma.checklistMessage.findUnique({ where: { id: access.checklistId }, ...CHECKLIST_SELECT });
  if (!checklist) return { error: "not_found" };
  return { error: null, checklist };
}

/** Ticks (`checked` true) or unticks one row. Setting the state asked for (not flipping it) makes repeats harmless. */
export async function setChecklistItemChecked(itemId: string, checked: boolean): Promise<ChecklistResult> {
  const user = await requireVerifiedUser();
  if (!idSchema.safeParse(itemId).success || typeof checked !== "boolean") return { error: "invalid" };
  const access = await start(user.id, await checklistIdOfItem(itemId));
  if ("error" in access) return { error: access.error };

  // Guarded on the current state: two people ticking the same row at once tick it once (the first one's name stays),
  // and a tick never undoes an untick that landed in between, or the other way round.
  const result = checked
    ? await prisma.checklistItem.updateMany({
        where: { id: itemId, checklistId: access.checklistId, checkedAt: null },
        data: { checkedAt: new Date(), checkedById: user.id },
      })
    : await prisma.checklistItem.updateMany({
        where: { id: itemId, checklistId: access.checklistId, checkedAt: { not: null } },
        data: { checkedAt: null, checkedById: null },
      });
  if (result.count === 0) {
    // Already in that state (fine), or the row was removed meanwhile.
    const exists = await prisma.checklistItem.count({ where: { id: itemId, checklistId: access.checklistId } });
    if (exists === 0) return { error: "not_found" };
  }
  return finish(access);
}

/** Adds a row at the end of the list (at most SHOPPING_LIST_MAX_ITEMS rows). */
export async function addChecklistItem(checklistId: string, text: string): Promise<ChecklistResult> {
  const user = await requireVerifiedUser();
  if (!idSchema.safeParse(checklistId).success) return { error: "invalid" };
  const access = await start(user.id, checklistId);
  if ("error" in access) return { error: access.error };
  if (access.secret) return { error: "not_supported_in_secret_chat" };
  const checked = await checkedText(text);
  if ("error" in checked) return { error: checked.error };

  // The count check and the next position under one per-list lock, so two people adding at once can't pass the cap
  // or take the same position.
  const added = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${checklistLockKey(access.checklistId)}))`;
    const [count, last] = await Promise.all([
      tx.checklistItem.count({ where: { checklistId: access.checklistId } }),
      tx.checklistItem.findFirst({
        where: { checklistId: access.checklistId },
        orderBy: { position: "desc" },
        select: { position: true },
      }),
    ]);
    if (!canAddChecklistItem(count)) return false;
    await tx.checklistItem.create({
      data: { checklistId: access.checklistId, text: checked.text, position: (last?.position ?? -1) + 1, addedById: user.id },
    });
    return true;
  });
  if (!added) return { error: "full" };
  return finish(access);
}

/** Rewrites one row's text (its ticked state stays). */
export async function editChecklistItem(itemId: string, text: string): Promise<ChecklistResult> {
  const user = await requireVerifiedUser();
  if (!idSchema.safeParse(itemId).success) return { error: "invalid" };
  const access = await start(user.id, await checklistIdOfItem(itemId));
  if ("error" in access) return { error: access.error };
  if (access.secret) return { error: "not_supported_in_secret_chat" };
  const checked = await checkedText(text);
  if ("error" in checked) return { error: checked.error };

  const result = await prisma.checklistItem.updateMany({
    where: { id: itemId, checklistId: access.checklistId },
    data: { text: checked.text },
  });
  if (result.count === 0) return { error: "not_found" };
  return finish(access);
}

/** Removes one row. A row someone else already removed answers not_found; the bubble then just shows the fresh list. */
export async function removeChecklistItem(itemId: string): Promise<ChecklistResult> {
  const user = await requireVerifiedUser();
  if (!idSchema.safeParse(itemId).success) return { error: "invalid" };
  const checklistId = await checklistIdOfItem(itemId);
  const access = await start(user.id, checklistId);
  if ("error" in access) return { error: access.error };

  await prisma.checklistItem.deleteMany({ where: { id: itemId, checklistId: access.checklistId } });
  return finish(access);
}
