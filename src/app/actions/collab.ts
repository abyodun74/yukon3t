"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { collabPostSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";
import { isCollabAdmin, getCollabMembership } from "@/lib/collab-permissions";
import { updateCollabEmbedding } from "@/lib/embeddings";

export async function createCollabPost(formData: FormData) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("postCreate", user.id);
  if (!allowed) {
    redirect("/collab/new?error=rate_limited");
  }

  const parsed = collabPostSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    type: formData.get("type"),
    worldwide: formData.get("worldwide") === "on",
    countries: formData.getAll("countries"),
  });
  if (!parsed.success) {
    redirect("/collab/new?error=invalid");
  }
  const { title, description, type, worldwide, countries } = parsed.data;

  const modResult = await moderateText(`${title}\n${description}`);
  if (!modResult.allowed) {
    redirect("/collab/new?error=moderation");
  }

  // Every collab gets a group chat from the start (for in-session text/
  // photo/video posting via the existing Message pipeline — see ChatThread
  // on the detail page), not lazily created on first join. Created as a
  // separate step rather than a nested `conversation: { create: {...} }` —
  // mixing that with the `authorId` scalar FK forces Prisma's "unchecked"
  // create-input variant, which only accepts `conversationId` directly.
  const conversation = await prisma.conversation.create({
    data: {
      isGroup: true,
      name: title,
      createdById: user.id,
      members: { create: { userId: user.id } },
    },
  });

  const post = await prisma.collabBoardPost.create({
    data: {
      title,
      description,
      type,
      worldwide,
      // Ignore any leftover selections if the client sent both — worldwide
      // always wins and the stored data stays unambiguous.
      countries: worldwide ? [] : countries,
      authorId: user.id,
      conversationId: conversation.id,
      // The author is automatically the collab's OWNER participant, same as
      // a Circle's creator getting an OWNER CircleMembership at creation.
      participants: {
        create: { userId: user.id, role: "OWNER" },
      },
    },
  });

  await updateCollabEmbedding(post.id, { title, description });

  revalidatePath("/collab");
  redirect(`/collab/${post.id}`);
}

export async function closeCollabPost(id: string) {
  const user = await requireVerifiedUser();
  await prisma.collabBoardPost.updateMany({
    where: { id, authorId: user.id },
    data: { status: "CLOSED" },
  });
  revalidatePath("/collab");
  revalidatePath(`/collab/${id}`);
}

/** Author or admin: deletes the collab outright — cascades its participants, session presence, and chat. Admins need this to clear out duplicate/spam collabs that aren't theirs, same as deleteCircle. */
export async function deleteCollabPost(id: string) {
  const user = await requireVerifiedUser();

  const collab = await prisma.collabBoardPost.findUnique({ where: { id } });
  if (!collab) {
    return { error: "not_found" as const };
  }
  if (collab.authorId !== user.id && !user.isAdmin) {
    return { error: "forbidden" as const };
  }

  await prisma.collabBoardPost.delete({ where: { id } });
  // The collab->conversation FK is SetNull (not cascade), so the group chat
  // would otherwise survive as an orphaned Conversation nobody can reach
  // from the collab anymore — clean it up explicitly instead.
  if (collab.conversationId) {
    await prisma.conversation.delete({ where: { id: collab.conversationId } }).catch(() => {});
  }

  revalidatePath("/collab");
  redirect("/collab");
}

/** Joins a collaboration — also adds the joiner to its group chat, if one already exists. */
export async function joinCollab(collabId: string) {
  const user = await requireVerifiedUser();

  const collab = await prisma.collabBoardPost.findUnique({
    where: { id: collabId },
    include: { participants: { where: { role: "MODERATOR" }, select: { userId: true } } },
  });
  if (!collab) {
    return { error: "not_found" as const };
  }

  const existing = await prisma.collabParticipant.findUnique({
    where: { userId_collabId: { userId: user.id, collabId } },
  });
  await prisma.collabParticipant.upsert({
    where: { userId_collabId: { userId: user.id, collabId } },
    create: { userId: user.id, collabId },
    update: {},
  });

  if (collab.conversationId) {
    await prisma.conversationMember.upsert({
      where: {
        conversationId_userId: { conversationId: collab.conversationId, userId: user.id },
      },
      create: { conversationId: collab.conversationId, userId: user.id },
      update: {},
    });
  }

  if (!existing) {
    // Notify the collab's author and any co-admins that someone new
    // joined — same shape as joinCircle's CIRCLE_JOINED notification.
    const recipientIds = new Set([collab.authorId, ...collab.participants.map((p) => p.userId)]);
    recipientIds.delete(user.id);
    if (recipientIds.size > 0) {
      await prisma.notification.createMany({
        data: [...recipientIds].map((recipientId) => ({
          recipientId,
          actorId: user.id,
          type: "COLLAB_JOINED" as const,
          collabId,
        })),
      });
    }
  }

  revalidatePath(`/collab/${collabId}`);
  return { error: null };
}

/** Leaves a collaboration — the author must close it instead of leaving, same rule as a Circle owner. */
export async function leaveCollab(collabId: string) {
  const user = await requireVerifiedUser();
  const collab = await prisma.collabBoardPost.findUnique({ where: { id: collabId } });
  if (collab?.authorId === user.id) {
    return { error: "owner_cannot_leave" as const };
  }

  await prisma.collabParticipant.deleteMany({ where: { userId: user.id, collabId } });
  if (collab?.conversationId) {
    await prisma.conversationMember.deleteMany({
      where: { conversationId: collab.conversationId, userId: user.id },
    });
  }

  revalidatePath(`/collab/${collabId}`);
  return { error: null };
}

/**
 * Co-admins (CollabParticipant.role "MODERATOR") get the same day-to-day
 * management powers as the collab's author — managing participants,
 * promoting further co-admins — except closing the collab outright, which
 * stays author/site-admin-only. Mirrors addCircleCoAdmin exactly.
 */
export async function addCollabCoAdmin(collabId: string, targetUserId: string) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("collabModerate", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const collab = await prisma.collabBoardPost.findUnique({ where: { id: collabId } });
  if (!collab) {
    return { error: "not_found" as const };
  }
  const myMembership = await getCollabMembership(collabId, user.id);
  if (!isCollabAdmin(collab, myMembership, user)) {
    return { error: "forbidden" as const };
  }
  if (targetUserId === collab.authorId) {
    return { error: "invalid" as const };
  }

  const targetMembership = await getCollabMembership(collabId, targetUserId);
  if (!targetMembership) {
    return { error: "not_a_participant" as const };
  }

  await prisma.collabParticipant.update({
    where: { userId_collabId: { userId: targetUserId, collabId } },
    data: { role: "MODERATOR" },
  });

  revalidatePath(`/collab/${collabId}`);
  return { error: null };
}

export async function removeCollabCoAdmin(collabId: string, targetUserId: string) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("collabModerate", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const collab = await prisma.collabBoardPost.findUnique({ where: { id: collabId } });
  if (!collab) {
    return { error: "not_found" as const };
  }
  const myMembership = await getCollabMembership(collabId, user.id);
  if (!isCollabAdmin(collab, myMembership, user)) {
    return { error: "forbidden" as const };
  }
  if (targetUserId === collab.authorId) {
    return { error: "invalid" as const };
  }

  await prisma.collabParticipant.updateMany({
    where: { userId: targetUserId, collabId, role: "MODERATOR" },
    data: { role: "PARTICIPANT" },
  });

  revalidatePath(`/collab/${collabId}`);
  return { error: null };
}

/** Author or co-admin: removes a participant outright. Can't be used on the collab's author. */
export async function removeCollabParticipant(collabId: string, targetUserId: string) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("collabModerate", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const collab = await prisma.collabBoardPost.findUnique({ where: { id: collabId } });
  if (!collab) {
    return { error: "not_found" as const };
  }
  const myMembership = await getCollabMembership(collabId, user.id);
  if (!isCollabAdmin(collab, myMembership, user)) {
    return { error: "forbidden" as const };
  }
  if (targetUserId === collab.authorId) {
    return { error: "invalid" as const };
  }

  await prisma.collabParticipant.deleteMany({ where: { userId: targetUserId, collabId } });
  if (collab.conversationId) {
    await prisma.conversationMember.deleteMany({
      where: { conversationId: collab.conversationId, userId: targetUserId },
    });
  }

  revalidatePath(`/collab/${collabId}`);
  return { error: null };
}
