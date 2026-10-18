"use server";

import { revalidatePath } from "next/cache";
import { requireVerifiedUser } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { moderateText } from "@/lib/moderation";
import { getBlockedEitherWayIds } from "@/lib/blocks";
import { captureError } from "@/lib/error-tracking";
import { pushActivityNotificationToMany } from "@/lib/notify-push";
import { publishEvent, publishEvents } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { classifyPostCategory } from "@/lib/feed-category";
import { afterPostCreated } from "@/lib/post-created";
import { pollCreateSchema, pollIdSchema, pollListSchema, pollUpdateSchema, pollVoteSchema } from "@/lib/validations";
import {
  canManagePoll,
  canSchedulePoll,
  futureTimeError,
  isPollOpen,
  leadingOptionIds,
  normalizePollOptions,
  planPollOptionEdits,
  planVote,
  pollParentError,
  pollRecipients,
  reopenClosesAt,
  scheduleFromPollError,
  voteSelectionError,
  type NormalizedPollOption,
} from "@/lib/polls";
import {
  circlePollScope,
  collabPollScope,
  getCirclePollAccess,
  getCollabPollAccess,
  loadPollPage,
  loadPollView,
  loadPollWithAccess,
  type PollParentAccess,
} from "@/lib/polls-data";

/**
 * Polls in Circles and on Collab Boards. Every action: the actor from the session, access from polls-data.ts (Circle
 * membership/channel access or collab participation, never the client's word), input through Zod and the pure rules in
 * lib/polls.ts, then Prisma. Question, description and option text pass moderateText before anything is stored, and a
 * flagged one is refused outright (like a Circle's name or a collab's title). Results are counts only; nothing returned
 * here names a voter.
 */

type PollError =
  | "rate_limited"
  | "invalid"
  | "not_found"
  | "forbidden"
  | "moderation"
  | "closed"
  | "collab_closed"
  | "too_few"
  | "too_many"
  | "duplicate"
  | "past_time"
  | "too_far"
  | "unknown_option"
  | "confirm_clear"
  | "already_scheduled"
  | "not_leading"
  | "not_schedule"
  | "no_channel";

function failure(error: PollError, extra: Record<string, unknown> = {}) {
  return { error, ...extra } as const;
}

/** The text a poll asks people to read, for moderation: question, description and every option's text. */
function pollText(question: string, description: string | null, options: readonly NormalizedPollOption[]) {
  return [question, description ?? "", ...options.map((o) => o.text ?? "")].filter(Boolean).join("\n");
}

function revalidateParent(parent: { circle?: { slug: string } | null; collabId?: string | null }) {
  if (parent.circle) revalidatePath(`/circles/${parent.circle.slug}`);
  if (parent.collabId) revalidatePath(`/collab/${parent.collabId}`);
}

/**
 * Tells every open page showing this parent's polls to refetch them (loadPolls below): a thin signal with an empty
 * payload, never the poll or the vote. Clients coalesce bursts (POLL_SIGNAL_* in lib/polls.ts), so a popular poll's
 * votes don't each cost every viewer a request. Best-effort, like every publishEvent.
 */
function signalPollsChanged(parent: { circleId?: string | null; collabId?: string | null }) {
  if (parent.circleId) return publishEvent(REALTIME_CHANNELS.circlePolls(parent.circleId), "changed");
  if (parent.collabId) return publishEvent(REALTIME_CHANNELS.collabPolls(parent.collabId), "changed");
  return Promise.resolve();
}

function parseTime(value: string | null | undefined) {
  return value ? new Date(value) : null;
}

export async function createPoll(input: unknown) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("pollCreate", user.id))) return failure("rate_limited");

  const parsed = pollCreateSchema.safeParse(input);
  if (!parsed.success || pollParentError(parsed.data)) return failure("invalid");
  const data = parsed.data;
  const now = new Date();

  const normalized = normalizePollOptions(data.kind, data.options);
  if ("error" in normalized) return failure(normalized.error);
  if (data.kind === "SCHEDULE") {
    for (const option of normalized.options) {
      const timeError = futureTimeError(option.startsAt!, now);
      if (timeError) return failure(timeError);
    }
  }
  const closesAt = parseTime(data.closesAt);
  if (closesAt) {
    const timeError = futureTimeError(closesAt, now);
    if (timeError) return failure(timeError);
  }

  let access: PollParentAccess;
  let circle: { id: string; slug: string; createdById: string; visibility: string } | null = null;
  let channel: { id: string; visibility: string } | null = null;
  if (data.circleId) {
    circle = await prisma.circle.findUnique({
      where: { id: data.circleId },
      select: { id: true, slug: true, createdById: true, visibility: true },
    });
    if (!circle) return failure("not_found");
    if (data.channelId) {
      channel = await prisma.channel.findFirst({
        where: { id: data.channelId, circleId: circle.id },
        select: { id: true, visibility: true },
      });
      if (!channel) return failure("invalid");
    }
    access = await getCirclePollAccess(circle, channel, user);
  } else {
    const collab = await prisma.collabBoardPost.findUnique({
      where: { id: data.collabId! },
      select: { id: true, authorId: true, visibility: true, status: true },
    });
    if (!collab) return failure("not_found");
    if (collab.status === "CLOSED") return failure("collab_closed");
    access = await getCollabPollAccess(collab, user);
  }
  if (!access.canCreate) return failure("forbidden");

  const moderation = await moderateText(pollText(data.question, data.description, normalized.options));
  if (!moderation.allowed) return failure("moderation");

  const poll = await prisma.poll.create({
    data: {
      circleId: circle?.id ?? null,
      channelId: channel?.id ?? null,
      collabId: data.collabId ?? null,
      createdById: user.id,
      kind: data.kind,
      question: data.question,
      description: data.description,
      allowMultiple: data.allowMultiple,
      closesAt,
      options: {
        create: normalized.options.map((option, position) => ({
          text: option.text,
          startsAt: option.startsAt,
          position,
        })),
      },
    },
    select: { id: true },
  });

  try {
    await notifyPollCreated(user.id, { circleId: circle?.id ?? null, channel, collabId: data.collabId ?? null });
  } catch (err) {
    console.error("[polls] poll-created notification failed", err);
    await captureError(err, { action: "createPoll", pollId: poll.id });
  }

  await signalPollsChanged({ circleId: circle?.id, collabId: data.collabId });
  revalidateParent({ circle, collabId: data.collabId });
  return { error: null, pollId: poll.id } as const;
}

/**
 * POLL_CREATED, bell only (like CIRCLE_LIVE), once per poll — edits never notify again. Circle members (a PRIVATE
 * channel's poll: its allow-list plus the Circle's admins) or collab participants, minus the creator and anyone
 * blocked either way with them, at most POLL_NOTIFY_MAX_RECIPIENTS (most recently joined first).
 */
async function notifyPollCreated(
  actorId: string,
  parent: { circleId: string | null; channel: { id: string; visibility: string } | null; collabId: string | null },
) {
  let candidates: string[];
  if (parent.circleId) {
    const members = await prisma.circleMembership.findMany({
      where: { circleId: parent.circleId },
      orderBy: { joinedAt: "desc" },
      select: { userId: true, role: true },
    });
    if (parent.channel && parent.channel.visibility !== "PUBLIC") {
      const allowed = new Set(
        (
          await prisma.channelMembership.findMany({ where: { channelId: parent.channel.id }, select: { userId: true } })
        ).map((m) => m.userId),
      );
      const circle = await prisma.circle.findUnique({ where: { id: parent.circleId }, select: { createdById: true } });
      candidates = members
        .filter((m) => allowed.has(m.userId) || m.role !== "MEMBER" || m.userId === circle?.createdById)
        .map((m) => m.userId);
    } else {
      candidates = members.map((m) => m.userId);
    }
  } else {
    const participants = await prisma.collabParticipant.findMany({
      where: { collabId: parent.collabId! },
      orderBy: { joinedAt: "desc" },
      select: { userId: true },
    });
    candidates = participants.map((p) => p.userId);
  }
  const recipients = pollRecipients(candidates, actorId, await getBlockedEitherWayIds(actorId));
  if (recipients.length === 0) return;

  await prisma.notification.createMany({
    data: recipients.map((recipientId) => ({
      recipientId,
      actorId,
      type: "POLL_CREATED" as const,
      circleId: parent.circleId,
      channelId: parent.channel?.id ?? null,
      collabId: parent.collabId,
    })),
  });
  await publishBadgeChanges(recipients);
}

/** notifyBadgeChange for a whole fan-out, batched (publishEvents). */
function publishBadgeChanges(userIds: string[]) {
  return publishEvents(userIds.map((id) => ({ channel: REALTIME_CHANNELS.navBadges(id), event: "changed" })));
}

/**
 * Edits a poll: question, description, closing time and options (add, rename, re-time, reorder, remove). What an
 * option edit does to its votes is planPollOptionEdits; when any vote would be removed the action answers
 * `confirm_clear` (with the number) unless `confirmClearVotes` is true, so the editor always sees it first. A poll
 * already scheduled from can't be edited (only closed, reopened or deleted). Kind and single/multiple choice are fixed.
 */
export async function updatePoll(pollId: string, input: unknown, confirmClearVotes = false) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("pollManage", user.id))) return failure("rate_limited");
  if (!pollIdSchema.safeParse(pollId).success) return failure("invalid");

  const loaded = await loadPollWithAccess(pollId, user);
  if (!loaded || !loaded.access.canView) return failure("not_found");
  const { poll, access } = loaded;
  const roles = { isPollCreator: poll.createdById === user.id, isMember: access.isMember, isParentAdmin: access.isParentAdmin };
  if (!canManagePoll(roles)) return failure("forbidden");
  if (poll.scheduledAt) return failure("already_scheduled");

  const parsed = pollUpdateSchema.safeParse(input);
  if (!parsed.success) return failure("invalid");
  const data = parsed.data;
  const now = new Date();

  const normalized = normalizePollOptions(poll.kind, data.options);
  if ("error" in normalized) return failure(normalized.error);

  const closesAt = parseTime(data.closesAt);
  if (closesAt && closesAt.getTime() !== poll.closesAt?.getTime()) {
    const timeError = futureTimeError(closesAt, now);
    if (timeError) return failure(timeError);
  }

  const existing = await prisma.pollOption.findMany({
    where: { pollId },
    select: { id: true, text: true, startsAt: true, _count: { select: { votes: true } } },
  });
  const plan = planPollOptionEdits(
    poll.kind,
    existing.map((o) => ({ id: o.id, text: o.text, startsAt: o.startsAt, voteCount: o._count.votes })),
    normalized.options,
    now,
  );
  if ("error" in plan) return failure(plan.error);
  if (plan.votesCleared > 0 && !confirmClearVotes) return failure("confirm_clear", { votesCleared: plan.votesCleared });

  const moderation = await moderateText(pollText(data.question, data.description, normalized.options));
  if (!moderation.allowed) return failure("moderation");

  await prisma.$transaction(async (tx) => {
    await tx.poll.update({
      where: { id: pollId },
      data: { question: data.question, description: data.description, closesAt },
    });
    if (plan.deletes.length > 0) await tx.pollOption.deleteMany({ where: { pollId, id: { in: plan.deletes } } });
    const cleared = plan.updates.filter((u) => u.clearVotes).map((u) => u.id);
    if (cleared.length > 0) await tx.pollVote.deleteMany({ where: { pollId, optionId: { in: cleared } } });
    for (const update of plan.updates) {
      await tx.pollOption.update({
        where: { id: update.id },
        data: { text: update.text, startsAt: update.startsAt, position: update.position },
      });
    }
    if (plan.creates.length > 0) {
      await tx.pollOption.createMany({ data: plan.creates.map((c) => ({ ...c, pollId })) });
    }
  });

  await signalPollsChanged(poll);
  revalidateParent({ circle: poll.circle, collabId: poll.collabId });
  return { error: null, votesCleared: plan.votesCleared } as const;
}

/** Closes or reopens a poll. Reopening clears a closing time that has already passed. */
export async function setPollOpen(pollId: string, open: boolean) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("pollManage", user.id))) return failure("rate_limited");
  if (!pollIdSchema.safeParse(pollId).success) return failure("invalid");

  const loaded = await loadPollWithAccess(pollId, user);
  if (!loaded || !loaded.access.canView) return failure("not_found");
  const { poll, access } = loaded;
  if (!canManagePoll({ isPollCreator: poll.createdById === user.id, isMember: access.isMember, isParentAdmin: access.isParentAdmin })) {
    return failure("forbidden");
  }

  await prisma.poll.update({
    where: { id: pollId },
    data: open
      ? { status: "OPEN", closesAt: reopenClosesAt(poll.closesAt, new Date()) }
      : { status: "CLOSED" },
  });
  await signalPollsChanged(poll);
  revalidateParent({ circle: poll.circle, collabId: poll.collabId });
  return { error: null } as const;
}

/** Deletes a poll with its options and votes. An event already scheduled from it stays. */
export async function deletePoll(pollId: string) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("pollManage", user.id))) return failure("rate_limited");
  if (!pollIdSchema.safeParse(pollId).success) return failure("invalid");

  const loaded = await loadPollWithAccess(pollId, user);
  if (!loaded || !loaded.access.canView) return failure("not_found");
  const { poll, access } = loaded;
  if (!canManagePoll({ isPollCreator: poll.createdById === user.id, isMember: access.isMember, isParentAdmin: access.isParentAdmin })) {
    return failure("forbidden");
  }

  await prisma.poll.delete({ where: { id: pollId } });
  await signalPollsChanged(poll);
  revalidateParent({ circle: poll.circle, collabId: poll.collabId });
  return { error: null } as const;
}

/**
 * Sets the viewer's vote to exactly `optionIds` (empty withdraws it). Members/participants only, while the poll is
 * open. Runs with the poll's row locked so two quick taps can't leave two picks in a single-choice poll. Answers with
 * the poll's fresh counts.
 */
export async function votePoll(pollId: string, optionIds: unknown) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("pollVote", user.id))) return failure("rate_limited");
  if (!pollIdSchema.safeParse(pollId).success) return failure("invalid");
  const parsed = pollVoteSchema.safeParse(optionIds);
  if (!parsed.success) return failure("invalid");

  const loaded = await loadPollWithAccess(pollId, user);
  if (!loaded || !loaded.access.canView) return failure("not_found");
  const { poll, access } = loaded;
  if (!access.isMember) return failure("forbidden");
  if (!isPollOpen(poll, new Date())) return failure("closed");

  const options = await prisma.pollOption.findMany({ where: { pollId }, select: { id: true } });
  if (voteSelectionError(parsed.data, poll.allowMultiple, new Set(options.map((o) => o.id)))) return failure("invalid");

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Poll" WHERE "id" = ${pollId} FOR UPDATE`;
    const current = await tx.pollVote.findMany({ where: { pollId, userId: user.id }, select: { optionId: true } });
    const { add, remove } = planVote(
      current.map((v) => v.optionId),
      parsed.data,
    );
    if (remove.length > 0) await tx.pollVote.deleteMany({ where: { pollId, userId: user.id, optionId: { in: remove } } });
    if (add.length > 0) {
      await tx.pollVote.createMany({
        data: add.map((optionId) => ({ pollId, optionId, userId: user.id })),
        skipDuplicates: true,
      });
    }
  });

  // The voter gets the fresh counts right here; everyone else hears the signal and refetches.
  const [view] = await Promise.all([loadPollView(pollId, user, access), signalPollsChanged(poll)]);
  return { error: null, poll: view } as const;
}

/**
 * A page of a Circle's or collab's polls as `PollView`s, for "Load more" (`mode: "older"`, after `cursor`) and for the
 * live refresh a poll signal triggers (`mode: "through"`: everything from the newest down to `cursor`, the oldest poll
 * the viewer has loaded; no cursor = the first page). Same visibility as the page itself (circlePollScope /
 * collabPollScope): not_found for anyone who may not see the list, so an id says nothing about whether it exists.
 */
export async function loadPolls(input: unknown) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("pollList", user.id))) return failure("rate_limited");
  const parsed = pollListSchema.safeParse(input);
  if (!parsed.success || pollParentError(parsed.data)) return failure("invalid");
  const { circleId, collabId, cursor, mode } = parsed.data;

  const scope = circleId ? await circlePollScope(circleId, user) : await collabPollScope(collabId!, user);
  if (!scope) return failure("not_found");
  const page = await loadPollPage(scope.where, user, scope.access, cursor ?? null, mode);
  return { error: null, ...page } as const;
}

/**
 * "Schedule from this option" on a SCHEDULE poll, once (lib/polls.ts: scheduleFromPollError, canSchedulePoll). Closes
 * the poll. In a Circle it posts an event (a Post with eventAt, the Circle's existing event mechanism: RSVPs and the
 * event-reminders cron) in the poll's channel, or the Circle's general text channel, and that post then goes through
 * the same steps as any Circle post (feed category and embedding, subscriber notifications and the Home feed signal:
 * afterPostCreated). On a collab it adds a one-off session (a CollabOneOffSession row; a collab can have several),
 * which the collab-session-reminders cron reminds about without touching the recurring schedule. Everyone who voted
 * (not the scheduler) gets POLL_SCHEDULED, bell + push.
 */
export async function schedulePollOption(pollId: string, optionId: string) {
  const user = await requireVerifiedUser();
  if (!(await checkRateLimit("pollManage", user.id))) return failure("rate_limited");
  if (!pollIdSchema.safeParse(pollId).success || !pollIdSchema.safeParse(optionId).success) return failure("invalid");

  const loaded = await loadPollWithAccess(pollId, user);
  if (!loaded || !loaded.access.canView) return failure("not_found");
  const { poll, access } = loaded;
  const now = new Date();
  const roles = { isPollCreator: poll.createdById === user.id, isMember: access.isMember, isParentAdmin: access.isParentAdmin };
  if (!canSchedulePoll({ ...roles, open: isPollOpen(poll, now) })) return failure("forbidden");
  if (poll.collab?.status === "CLOSED") return failure("collab_closed");

  const [option, counts] = await Promise.all([
    prisma.pollOption.findFirst({ where: { id: optionId, pollId }, select: { id: true, startsAt: true } }),
    prisma.pollVote.groupBy({ by: ["optionId"], where: { pollId }, _count: { _all: true } }),
  ]);
  const leading = leadingOptionIds(counts.map((c) => ({ id: c.optionId, count: c._count._all })));
  const scheduleError = scheduleFromPollError(poll, option, leading, now);
  if (scheduleError) return failure(scheduleError);
  const startsAt = option!.startsAt!;

  // A Circle event goes in the poll's own text channel, else the Circle's "general" (or first) text channel.
  let channelId: string | null = null;
  if (poll.circleId) {
    const channels = await prisma.channel.findMany({
      where: { circleId: poll.circleId, type: "TEXT" },
      orderBy: { position: "asc" },
      select: { id: true, slug: true },
    });
    channelId =
      channels.find((c) => c.id === poll.channelId)?.id ??
      channels.find((c) => c.slug === "general")?.id ??
      channels[0]?.id ??
      null;
    if (!channelId) return failure("no_channel");
  }

  // The event post's content, classified (feed category + embedding) like createPost does, before the transaction so
  // the OpenAI call holds no row lock. The question and description already passed moderation when the poll was
  // created or last edited.
  const eventContent = poll.description ? `${poll.question}\n\n${poll.description}` : poll.question;
  const classified = poll.circleId ? await classifyPostCategory(eventContent) : null;

  const scheduled = await prisma.$transaction(async (tx) => {
    // The claim: only one schedule per poll, whoever gets here first.
    const claimed = await tx.poll.updateMany({
      where: { id: pollId, scheduledAt: null },
      data: { scheduledAt: startsAt, scheduledOptionId: option!.id, status: "CLOSED" },
    });
    if (claimed.count === 0) return null;
    if (poll.circleId) {
      const post = await tx.post.create({
        data: {
          authorId: user.id,
          circleId: poll.circleId,
          channelId,
          content: eventContent,
          // Inside a Circle membership is the access boundary; stored PUBLIC like every Circle post (createPost).
          visibility: "PUBLIC",
          mediaType: "NONE",
          feedCategory: classified!.category,
          eventAt: startsAt,
        },
        select: { id: true, authorId: true, circleId: true, channelId: true, visibility: true },
      });
      await tx.poll.update({ where: { id: pollId }, data: { scheduledPostId: post.id } });
      return { post };
    }
    // A new row: one-off sessions this collab already has (from other polls) stay.
    await tx.collabOneOffSession.create({ data: { collabId: poll.collabId!, startsAt, pollId } });
    return { post: null };
  });
  if (!scheduled) return failure("already_scheduled");

  if (scheduled.post) {
    try {
      await afterPostCreated({
        post: scheduled.post,
        moderationStatus: "PUBLISHED",
        feedCategory: classified!.category,
        embedding: classified!.embedding,
        mediaType: "NONE",
      });
    } catch (err) {
      // The event exists and the poll is scheduled; a failed follow-up must not report the schedule as failed.
      console.error("[polls] event post follow-up failed", err);
      await captureError(err, { action: "schedulePollOption", pollId, postId: scheduled.post.id });
    }
  }

  try {
    await notifyPollScheduled(pollId, user, {
      circleId: poll.circleId,
      circleSlug: poll.circle?.slug ?? null,
      collabId: poll.collabId,
      postId: scheduled.post?.id ?? null,
    });
  } catch (err) {
    console.error("[polls] poll-scheduled notification failed", err);
    await captureError(err, { action: "schedulePollOption", pollId });
  }

  await signalPollsChanged(poll);
  revalidateParent({ circle: poll.circle, collabId: poll.collabId });
  if (poll.circle) revalidatePath("/home");
  return { error: null, postId: scheduled.post?.id ?? null } as const;
}

/** POLL_SCHEDULED to everyone who voted (any option), minus the scheduler and anyone blocked either way: bell + push. */
async function notifyPollScheduled(
  pollId: string,
  actor: { id: string; name: string | null },
  target: { circleId: string | null; circleSlug: string | null; collabId: string | null; postId: string | null },
) {
  const voters = await prisma.pollVote.findMany({
    where: { pollId },
    distinct: ["userId"],
    select: { userId: true },
  });
  const recipients = pollRecipients(
    voters.map((v) => v.userId),
    actor.id,
    await getBlockedEitherWayIds(actor.id),
  );
  if (recipients.length === 0) return;

  await prisma.notification.createMany({
    data: recipients.map((recipientId) => ({
      recipientId,
      actorId: actor.id,
      type: "POLL_SCHEDULED" as const,
      circleId: target.circleId,
      collabId: target.collabId,
      postId: target.postId,
    })),
  });
  // The polls section of the Circle / collab page, where notificationHref sends the bell row too (the poll card there
  // links to the Circle event post).
  const url = target.circleSlug ? `/circles/${target.circleSlug}#polls` : `/collab/${target.collabId}#polls`;
  await pushActivityNotificationToMany(recipients, "POLL_SCHEDULED", actor.name, url);
  await publishBadgeChanges(recipients);
}
