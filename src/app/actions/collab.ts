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
import { notifySubscribers } from "@/lib/notify-subscribers";
import { nextOccurrence } from "@/lib/collab-schedule";
import { collabFieldsFromIssues, collabInvalidPath } from "@/lib/collab-form-errors";
import { expandCircleInvites, getAcceptedConnectionIds, sendCollabInvites } from "@/lib/collab-invites-server";
import { canCollabInviterStillInvite, canInviteToCollab } from "@/lib/collab-invite";
import { pendingInviteClaimWhere } from "@/lib/invite-standing";

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
    circleIds: formData.getAll("circleIds"),
    scheduleDays: formData.getAll("scheduleDays"),
    scheduleTime: formData.get("scheduleTime") || undefined,
  });
  if (!parsed.success) {
    // Names which inputs failed (allowlisted) so the form can take the person straight to them.
    redirect(collabInvalidPath(collabFieldsFromIssues(parsed.error.issues)));
  }
  const {
    title,
    description,
    type,
    worldwide,
    countries,
    visibility,
    inviteeIds,
    circleIds,
    scheduleDays,
    scheduleTime,
  } = parsed.data;
  const nextSessionAt = scheduleTime ? nextOccurrence(scheduleDays, scheduleTime, new Date()) : null;

  // Invitees must be one of the organizer's accepted connections — same
  // trust boundary addGroupMembers enforces for group-chat invites. Anything
  // else is silently dropped rather than erroring, since a stale client-side
  // selection (e.g. a connection removed mid-form) shouldn't block posting.
  // Members of a chosen Circle are the exception: see expandCircleInvites.
  let validInviteeIds: string[] = [];
  if (visibility === "PRIVATE") {
    const acceptedConnectionIds = await getAcceptedConnectionIds(user.id);
    validInviteeIds = [...new Set(inviteeIds.filter((id) => acceptedConnectionIds.has(id)))];
    if (circleIds.length > 0) {
      if (!(await checkRateLimit("collabCircleInvite", user.id))) {
        redirect("/collab/new?error=rate_limited");
      }
      const expanded = await expandCircleInvites(user.id, circleIds, {
        participantIds: [],
        existingInviteeIds: [],
        alsoInvitingIds: validInviteeIds,
      });
      if (expanded.error) {
        redirect(expanded.error === "too_large" ? "/collab/new?error=too_large" : collabInvalidPath(["inviteeIds"]));
      }
      validInviteeIds = [...validInviteeIds, ...expanded.inviteeIds];
    }
    if (validInviteeIds.length === 0) {
      redirect(collabInvalidPath(["inviteeIds"]));
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
      scheduleDays,
      scheduleTime: scheduleTime ?? null,
      nextSessionAt,
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
      skipDuplicates: true,
    });
    await prisma.notification.createMany({
      data: validInviteeIds.map((inviteeId) => ({
        recipientId: inviteeId,
        actorId: user.id,
        type: "COLLAB_INVITE" as const,
        collabId: post.id,
      })),
      skipDuplicates: true,
    });
  }

  await updateCollabEmbedding(post.id, { title, description });

  // PRIVATE collabs already notify their specific invitees above
  // (COLLAB_INVITE) — broadcasting to every subscriber/connection
  // regardless of whether they were invited would leak a supposedly
  // invite-only collab. This already reaches every accepted connection
  // too, not just declared subscribers (accepting a connection request
  // auto-subscribes both sides — see respondToConnectionRequest in
  // actions/connections.ts).
  if (visibility === "PUBLIC") {
    await notifySubscribers(user.id, "SUBSCRIPTION_COLLAB", { collabId: post.id });
  }

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
    scheduleDays: formData.getAll("scheduleDays"),
    scheduleTime: formData.get("scheduleTime") || undefined,
  });
  if (!parsed.success) {
    redirect(`/collab/${id}/edit?error=invalid`);
  }
  const { title, description, type, worldwide, countries, scheduleDays, scheduleTime } = parsed.data;
  const nextSessionAt = scheduleTime ? nextOccurrence(scheduleDays, scheduleTime, new Date()) : null;

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
      scheduleDays,
      scheduleTime: scheduleTime ?? null,
      nextSessionAt,
      // Tied to the OLD nextSessionAt's occurrence — must reset whenever
      // the schedule changes (or is removed), or the reminder cron's own
      // null-check would wrongly treat the new occurrence as already
      // reminded and skip it forever.
      sessionReminderSentAt: null,
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

/**
 * Author or co-admin of a PRIVATE collab (canInviteToCollab: no site-admin shortcut, since an invite stands only while
 * its inviter is the author or an OWNER/MODERATOR participant): invites specific people (their accepted connections)
 * and/or the members of Circles they created — everyone must accept via respondToCollabInvite before they're a
 * participant. `invited` and `skipped` count the Circle members only (the success line names the Circles).
 */
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
  if (!canInviteToCollab(collab, myMembership, user.id)) {
    return { error: "forbidden" as const };
  }
  if (collab.visibility !== "PRIVATE") {
    return { error: "not_private" as const };
  }

  const parsed = collabInviteSchema.safeParse({
    inviteeIds: formData.getAll("inviteeIds"),
    circleIds: formData.getAll("circleIds"),
  });
  if (!parsed.success) {
    return { error: "invalid" as const };
  }
  const result = await sendCollabInvites(user.id, collab, parsed.data);
  if (!result.error) {
    revalidatePath(`/collab/${collabId}`);
  }
  return result;
}

/**
 * Invitee only: accepts or declines a pending CollabInvite. Mirrors respondToCircleInvite: an invite only stands while
 * its inviter is still the author or an OWNER/MODERATOR participant with an ACTIVE account
 * (canCollabInviterStillInvite); accepting one that doesn't deletes it (with the invitee's bell entry) and answers
 * `invite_expired`. Both answers are a guarded claim on PENDING and the inviter that was judged
 * (pendingInviteClaimWhere): a cancelled, already-answered or re-sent invite matches nothing and answers `not_found`
 * with no side effects, so a double tap or a stale client can't add the participant or notify anyone twice.
 */
export async function respondToCollabInvite(inviteId: string, accept: boolean) {
  const user = await requireVerifiedUser();

  const invite = await prisma.collabInvite.findUnique({
    where: { id: inviteId },
    select: {
      id: true,
      inviteeId: true,
      inviterId: true,
      collabId: true,
      collab: {
        select: {
          id: true,
          authorId: true,
          conversationId: true,
          participants: { where: { role: "MODERATOR" }, select: { userId: true } },
        },
      },
    },
  });
  if (!invite) {
    return { error: "not_found" as const };
  }
  if (invite.inviteeId !== user.id) {
    return { error: "forbidden" as const };
  }
  const claim = pendingInviteClaimWhere(invite);

  if (!accept) {
    const { count } = await prisma.collabInvite.updateMany({
      where: claim,
      data: { status: "DECLINED", respondedAt: new Date() },
    });
    if (count === 0) {
      return { error: "not_found" as const };
    }
    revalidatePath(`/collab/${invite.collabId}`);
    return { error: null };
  }

  const [inviter, inviterMembership] = await Promise.all([
    prisma.user.findUnique({ where: { id: invite.inviterId }, select: { id: true, status: true } }),
    getCollabMembership(invite.collabId, invite.inviterId),
  ]);
  if (!canCollabInviterStillInvite(invite.collab, inviter, inviterMembership)) {
    // Guarded on the inviter judged: an admin may have re-sent it (same row, new inviter) in between, and that fresh
    // invite must not be deleted on this check.
    const { count: removed } = await prisma.collabInvite.deleteMany({ where: claim });
    if (removed > 0) {
      await prisma.notification.deleteMany({
        where: { recipientId: user.id, collabId: invite.collabId, type: "COLLAB_INVITE" },
      });
    }
    revalidatePath(`/collab/${invite.collabId}`);
    return { error: "invite_expired" as const };
  }

  const { count } = await prisma.collabInvite.updateMany({
    where: claim,
    data: { status: "ACCEPTED", respondedAt: new Date() },
  });
  if (count === 0) {
    return { error: "not_found" as const };
  }

  // Only the request that won the claim gets here, so the participant is added and everyone notified exactly once.
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

  revalidatePath(`/collab/${invite.collabId}`);
  return { error: null };
}

/** Author or co-admin (canInviteToCollab): withdraws a PENDING invite, stale or not — the row is deleted, with the invitee's bell entry for it. */
export async function cancelCollabInvite(inviteId: string) {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("collabModerate", user.id);
  if (!allowed) {
    return { error: "rate_limited" as const };
  }

  const invite = await prisma.collabInvite.findUnique({
    where: { id: inviteId },
    select: { inviteeId: true, collab: { select: { id: true, authorId: true } } },
  });
  if (!invite) {
    return { error: "not_found" as const };
  }
  const myMembership = await getCollabMembership(invite.collab.id, user.id);
  if (!canInviteToCollab(invite.collab, myMembership, user.id)) {
    return { error: "forbidden" as const };
  }

  const { count } = await prisma.collabInvite.deleteMany({ where: { id: inviteId, status: "PENDING" } });
  if (count === 0) {
    return { error: "not_found" as const };
  }
  await prisma.notification.deleteMany({
    where: { recipientId: invite.inviteeId, collabId: invite.collab.id, type: "COLLAB_INVITE" },
  });

  revalidatePath(`/collab/${invite.collab.id}`);
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
