"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { messageSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";

export async function sendMessage(formData: FormData) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("messageSend", user.id);
  if (!allowed) {
    return { error: "rate_limited" };
  }

  const parsed = messageSchema.safeParse({
    conversationId: formData.get("conversationId") || undefined,
    content: formData.get("content"),
  });
  if (!parsed.success || !parsed.data.conversationId) {
    return { error: "invalid" };
  }
  const { conversationId, content } = parsed.data;

  // Ownership check: the sender must actually be a member of this
  // conversation — never trust a client-supplied conversationId alone.
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: user.id } },
  });
  if (!membership) {
    return { error: "not_a_member" };
  }

  const modResult = await moderateText(content);
  const moderationStatus = modResult.allowed ? "PUBLISHED" : "FLAGGED";

  await prisma.message.create({
    data: { conversationId, senderId: user.id, content, moderationStatus },
  });

  revalidatePath(`/messages/${conversationId}`);
  return { error: null };
}
