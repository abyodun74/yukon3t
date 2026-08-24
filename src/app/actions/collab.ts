"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { collabPostSchema, collabInviteSchema } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";
import { isCollabAdmin, getCollabMembership } from "@/lib/collab-permissions";
import { updateCollabEmbedding } from "@/lib/embeddings";
import { isUniqueConstraintError } from "@/lib/prisma-errors";

/** Accepted Connections of `userId`, as a flat set of the *other* user's id — same rule used by messages/[id]/page.tsx's group-add candidates and post-visibility.ts. */
async function getAcceptedConnectionIds(userId: string): Promise<Set<string>> {
  const connections = await prisma.connection.findMany({
    where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { targetId: userId }] },
  });
  return new Set(connections.map((c) => (c.requesterId === userId ? c.targetId : c.requesterId)));
}

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
    visibility: formData.get("visibility"),
    inviteeIds: formData.getAll("inviteeIds"),
  });
  if (!parsed.success) {
    redirect("/collab/new?error=invalid");
  }
  const { title, description, type, worldwide, countries, visibility, inviteeIds } = parsed.data;

  // Invitees must be one of the organizer's accepted connections — same
  // trust boundary addGroupMembers enforces for group-chat invites. Anything
  // else is silently dropped rather than erroring, since a stale client-side
  // selection (e.g. a connection removed mid-form) shouldn't block posting.
  let validInviteeIds: string[] = [];
  if (visibility === "PRIVATE") {
    const acceptedConnectionIds = await getAcceptedConnectionIds(user.id);
    validInviteeIds = inviteeIds.filter((id) => acceptedConnectionIds.has(id));
    if (validInviteeIds.length === 0) {
      redirect("/collab/new?error=invalid");
    }
  }

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
      visibility,
      authorId: user.id,
      conversationId: conversation.id,
      // The author is automatically the collab's OWNER participant, same as
      // a Circle's creator getting an OWNER CircleMembership at creation.
      participants: {
        create: { userId: user.id, role: "OWNER" },
      },
    },
  });

  if (validInviteeIds.length > 0) {
    await prisma.collabInvite.createMany({
      data: validInviteeIds.map((inviteeId) => ({
        collabId: post.id,
        inviterId: user.id,
        inviteeId,
      })),
    });
    await prisma.notification.createMany({
      data: validInviteeIds.map((inviteeId) => ({
        recipientId: inviteeId,
        actorId: user.id,
        type: "COLLAB_INVITE" as const,
        collabId: post.id,
      })),
    });
  }

  await updateCollabEmbedding(post.id, { title, description });

  revalidatePath("/collab");
  redirect(`/collab/${post.id}`);
}

/**
 * Author or co-admin: edits a collab's title/type/description/countries in
 * place after it's been posted (and regardless of whether anyone has already
 * joined or a session has started — there's no lifecycle lock on this data,
 * unlike a chat message). Re-runs moderation and refreshes the embedding
 * exactly like createCollabPost, since the text is changing.
 */
export async function updateCollabPost(id: string, formData: FormData) {
  const user = await requireVerifiedUser();

  const collab = await prisma.collabBoardPost.findUnique({ where: { id } });
  if (!collab) {
    redirect("/collab");
  }
  const membership = await getCollabMembership(id, user.id);
  if (!isCollabAdmin(collab, membership, user)) {
    redirect(`/collab/${id}`);
  }

  const allowed = await checkRateLimit("collabModerate", user.id);
  if (!allowed) {
    redirect(`/collab/${id}/edit?error=rate_limited`);
  }

  const parsed = collabPostSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    type: formData.get("type"),
    worldwide: formData.get("worldwide") === "on",
    countries: formData.getAll("countries"),
  });
  if (!parsed.success) {
    redirect(`/collab/${id}/edit?error=invalid`);
  }
  const { title, description, type, worldwide, countries } = parsed.data;

  const modResult = await moderateText(`${title}\n${description}`);
  if (!modResult.allowed) {
    redirect(`/collab/${id}/edit?error=moderation`);
  }

  await prisma.collabBoardPost.update({
    where: { id },
    data: {
      title,
      description,
      type,
      worldwide,
      countries: worldwide ? [] : countries,
    },
  });

  await updateCollabEmbedding(id, { title, description });

  revalidatePath("/collab");
  revalidatePath(`/collab/${id}`);
  redirect(`/collab/${id}`);
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

/** Adds `userId` to a collab's participants + group chat and notifies the author/co-admins — the shared tail end of an instant join, an approved CollabJoinRequest, and an accepted CollabInvite. */
async function addCollabParticipant(
  collab: { id: string; authorId: string; conversationId: string | null },
  userId: string,
  moderatorIds: string[],
) {
  const existing = await prisma.collabParticipant.findUnique({
    where: { userId_collabId: { userId, collabId: collab.id } },
  });
  await prisma.collabParticipant.upsert({
    where: { userId_collabId: { userId, collabId: collab.id } },
    create: { userId, collabId: collab.id },
    update: {},
  });

  if (collab.conversationId) {
    await prisma.conversationMember.upsert({
      where: {
        conversationId_userId: { conversationId: collab.conversationId, userId },
      },
      create: { conversationId: collab.conversationId, userId },
      update: {},
    });
  }

  if (!existing) {
    const recipientIds = new Set([collab.authorId, ...moderatorIds]);
    recipientIds.delete(userId);
    if (recipientIds.size > 0) {
      await prisma.notification.createMany({
        data: [...recipientIds].map((recipientId) => ({
          recipientId,
          actorId: userId,
          type: "COLLAB_JOINED" as const,
          collabId: collab.id,
        })),
      });
    }
  }
}

/**
 * PUBLIC collabs: requests to join instead of joining instantly — the
 * organizer/co-admins screen it via respondToCollabJoinRequest. Mirrors
 * joinCircle's PRIVATE branch.
 * PRIVATE collabs: no self-serve path at all — only an organizer-sent
 * CollabInvite (respondToCollabInvite) gets someone in.
 */
export async function joinCollab(collabId: string) {
  const user = await requireVerifiedUser();

  const collab = await prisma.collabBoardPost.findUnique({
    where: { id: collabId },
    include: { participants: { where: { role: "MODERATOR" }, select: { userId: true } } },
  });
  if (!collab) {
    return { error: "not_found" as const };
  }

  const alreadyParticipant = await prisma.collabParticipant.findUnique({
    where: { userId_collabId: { userId: user.id, collabId } },
  });
  if (alreadyParticipant) {
    revalidatePath(`/collab/${collabId}`);
    return { error: null, requested: false };
  }

  if (collab.visibility === "PRIVATE") {
    return { error: "invite_only" as const, requested: false };
  }

  const existingRequest = await prisma.collabJoinRequest.findUnique({
    where: { collabId_userId: { collabId, userId: user.id } },
  });
  if (!existingRequest) {
    try {
      await prisma.collabJoinRequest.create({ data: { collabId, userId: user.id } });
    } catch (err) {
      // A fast double-click can race past the !existingRequest check above —
      // @@unique([collabId, userId]) then rejects the second create. The
      // request already exists either way, so this is a success, not an error.
      if (!isUniqueConstraintError(err)) throw err;
    }
  } else if (existingRequest.status === "DECLINED") {
    await prisma.collabJoinRequest.update({
      where: { id: existingRequest.id },
      data: { status: "PENDING", respondedAt: null },
    });
  }

  const recipientIds = new Set([collab.authorId, ...collab.participants.map((p) => p.userId)]);
  recipientIds.delete(user.id);
  if (recipientIds.size > 0 && !existingRequest) {
    await prisma.notification.createMany({
      data: [...recipientIds].map((recipientId) => ({
        recipientId,
        actorId: user.id,
        type: "COLLAB_JOIN_REQUEST" as const,
        collabId,
      })),
    });
  }

  revalidatePath(`/collab/${collabId}`);
  return { error: null, requested: true };
}

/** Author or co-admin of a PUBLIC collab: approves or declines a pending CollabJoinRequest. Mirrors respondToCircleJoinRequest. */
export async function respondToCollabJoinRequest(requestId: string, approve: boolean) {
  const user = await requireVerifiedUser();

  const request = await prisma.collabJoinRequest.findUnique({
    where: { id: requestId },
    include: {
      collab: {
        include: { participants: { where: { role: "MODERATOR" }, select: { userId: true } } },
      },
    },
  });
  if (!request) {
    return { error: "not_found" as const };
  }
  const myMembership = await getCollabMembership(request.collabId, user.id);
  if (!isCollabAdmin(request.collab, myMembership, user)) {
    return { error: "forbidden" as const };
  }

  if (approve) {
    await addCollabParticipant(
      request.collab,
      request.userId,
      request.collab.participants.map((p) => p.userId),
    );
    await prisma.notification.create({
      data: {
        recipientId: request.userId,
        actorId: user.id,
        type: "COLLAB_JOIN_APPROVED",
        collabId: request.collabId,
      },
    });
  }

  await prisma.collabJoinRequest.update({
    where: { id: requestId },
    data: { status: approve ? "APPROVED" : "DECLINED", respondedAt: new Date() },
  });

  revalidatePath(`/collab/${request.collabId}`);
  return { error: null };
}

/** Author or co-admin of a PRIVATE collab: invites specific people (their accepted connections) to it — they must accept via respondToCollabInvite before they're a participant. */
export async function inviteToCollab(collabId: string, formData: FormData) {
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
  if (collab.visibility !== "PRIVATE") {
    return { error: "not_private" as const };
  }

  const parsed = collabInviteSchema.safeParse({ inviteeIds: formData.getAll("inviteeIds") });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }

  const [acceptedConnectionIds, existingParticipants] = await Promise.all([
    getAcceptedConnectionIds(user.id),
    prisma.collabParticipant.findMany({ where: { collabId }, select: { userId: true } }),
  ]);
  const participantIds = new Set(existingParticipants.map((p) => p.userId));
  const inviteeIds = parsed.data.inviteeIds.filter(
    (id) => acceptedConnectionIds.has(id) && !participantIds.has(id),
  );
  if (inviteeIds.length === 0) {
    return { error: "invalid" as const };
  }

  const existingInvites = await prisma.collabInvite.findMany({
    where: { collabId, inviteeId: { in: inviteeIds } },
  });
  const existingByInvitee = new Map(existingInvites.map((i) => [i.inviteeId, i]));
  // Already-pending or already-accepted invitees are a no-op re-invite —
  // only brand-new invitees and DECLINED ones being re-sent need action.
  const toCreate = inviteeIds.filter((id) => !existingByInvitee.has(id));
  const toReset = inviteeIds.filter((id) => existingByInvitee.get(id)?.status === "DECLINED");
  const notifiedIds = [...toCreate, ...toReset];
  if (notifiedIds.length === 0) {
    return { error: null };
  }

  await Promise.all(
    toReset.map((inviteeId) =>
      prisma.collabInvite.update({
        where: { id: existingByInvitee.get(inviteeId)!.id },
        data: { status: "PENDING", respondedAt: null },
      }),
    ),
  );
  if (toCreate.length > 0) {
    await prisma.collabInvite.createMany({
      data: toCreate.map((inviteeId) => ({ collabId, inviterId: user.id, inviteeId })),
    });
  }
  await prisma.notification.createMany({
    data: notifiedIds.map((inviteeId) => ({
      recipientId: inviteeId,
      actorId: user.id,
      type: "COLLAB_INVITE" as const,
      collabId,
    })),
  });

  revalidatePath(`/collab/${collabId}`);
  return { error: null };
}

/** Invitee only: accepts or declines a pending CollabInvite. */
export async function respondToCollabInvite(inviteId: string, accept: boolean) {
  const user = await requireVerifiedUser();

  const invite = await prisma.collabInvite.findUnique({
    where: { id: inviteId },
    include: {
      collab: {
        include: { participants: { where: { role: "MODERATOR" }, select: { userId: true } } },
      },
    },
  });
  if (!invite) {
    return { error: "not_found" as const };
  }
  if (invite.inviteeId !== user.id) {
    return { error: "forbidden" as const };
  }

  if (accept) {
    await addCollabParticipant(
      invite.collab,
      user.id,
      invite.collab.participants.map((p) => p.userId),
    );
    await prisma.notification.create({
      data: {
        recipientId: invite.inviterId,
        actorId: user.id,
        type: "COLLAB_INVITE_ACCEPTED",
        collabId: invite.collabId,
      },
    });
  }

  await prisma.collabInvite.update({
    where: { id: inviteId },
    data: { status: accept ? "ACCEPTED" : "DECLINED", respondedAt: new Date() },
  });

  revalidatePath(`/collab/${invite.collabId}`);
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
