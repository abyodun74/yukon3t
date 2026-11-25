import { prisma } from "@/lib/prisma";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { createNonE2eeMessage } from "@/lib/non-e2ee-message";
import { afterMessageSent } from "@/lib/after-message-sent";
import { findDirectConversationId, startDirectConversation } from "@/lib/direct-conversation";
import { isMembershipLocked } from "@/lib/hidden-chats";
import { captureError } from "@/lib/error-tracking";
import { callReplyRequestId } from "@/lib/call-quick-reply";

// The chat half of declining a call with a quick reply (declineCallWithReply in actions/calls.ts): the reply is an
// ordinary direct message from the callee to the caller, written through the same machinery as any other
// server-built message (createNonE2eeMessage, which refuses a secret chat; afterMessageSent, which pushes it to the
// caller and adds their bell row exactly like any message). In a lib file, not the "use server" one: it trusts its
// arguments (the action has already checked the call, the connection, blocks and rate limits).

/**
 * Where the reply will go, decided BEFORE the call is declined so a refusal changes nothing: the pair's existing 1:1
 * chat (null: none yet, one is made on delivery), or `hidden_locked` when the callee has hidden that chat and it is
 * locked right now (a reply would have to be written into it).
 */
export async function callReplyConversation(
  calleeId: string,
  callerId: string,
): Promise<{ error: null; conversationId: string | null } | { error: "hidden_locked" | "unavailable" }> {
  const conversationId = await findDirectConversationId(calleeId, callerId);
  if (!conversationId) return { error: null, conversationId: null };
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: calleeId } },
    select: { hiddenAt: true },
  });
  if (!membership) return { error: "unavailable" };
  if (await isMembershipLocked(membership, calleeId)) return { error: "hidden_locked" };
  return { error: null, conversationId };
}

/**
 * Sends the reply as a chat message from the callee, once per call: the message is stored under the call's own
 * clientRequestId, so even a second delivery attempt for the same call can't make a second message. Never throws: the
 * call is already declined and the caller already has the reply on their screen, so a failure here only costs the
 * chat copy. Answers whether a message was stored by this attempt.
 */
export async function deliverCallReply(input: {
  callee: { id: string; name: string | null };
  caller: { id: string; openToIntents: Parameters<typeof startDirectConversation>[1]["openToIntents"] };
  callId: string;
  content: string;
  conversationId: string | null;
}): Promise<boolean> {
  const { callee, caller, callId, content } = input;
  let conversationId = input.conversationId;
  let messageId: string;
  try {
    // The two are connected (the action checked), so this only creates the chat, never a message request.
    if (!conversationId) conversationId = await startDirectConversation(callee.id, caller, "call_reply");
    const sent = await createNonE2eeMessage({
      conversationId,
      senderId: callee.id,
      content,
      mediaType: "NONE",
      moderationStatus: "PUBLISHED",
      clientRequestId: callReplyRequestId(callId),
    });
    // A secret chat can't take a message the server wrote: the caller still saw the reply on their call screen.
    if (sent.error) return false;
    messageId = sent.id;
  } catch (err) {
    if (isUniqueConstraintError(err)) return false;
    console.error("[call-quick-reply] chat message failed after the call was declined", err);
    await captureError(err, { where: "deliverCallReply", callId });
    return false;
  }

  try {
    await prisma.call.update({ where: { id: callId }, data: { declineReplyMessageId: messageId } });
  } catch (err) {
    await captureError(err, { where: "deliverCallReply.link", callId });
  }
  // Chat text isn't scanned (see the moderation notes); the push and bell row are the caller's notice when they have
  // already left the call screen.
  await afterMessageSent({
    user: callee,
    conversationId,
    memberIds: [callee.id, caller.id],
    secret: false,
    content,
    mediaType: "NONE",
  });
  return true;
}
