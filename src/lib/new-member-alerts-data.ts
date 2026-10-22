import { prisma } from "@/lib/prisma";
import { sendFcmActivityToUsers } from "@/lib/fcm";
import { nameOrSomeone, newMemberPushBody } from "@/lib/push-text";
import { publishEvents } from "@/lib/realtime-server";
import { REALTIME_CHANNELS } from "@/lib/realtime-channels";
import { captureError } from "@/lib/error-tracking";
import {
  NEW_MEMBER_BATCH_SIZE,
  NEW_MEMBER_COALESCE_MS,
  NEW_MEMBER_MAX_RECIPIENTS,
  NEW_MEMBER_PUSH_COOLDOWN_MS,
  blockPairKey,
  groupByActorAndCount,
  newMemberCandidateWhere,
  newMemberHref,
  newMemberMessageData,
  newMemberRecipientWhere,
  planNewMemberAlerts,
} from "@/lib/new-member-alerts";

/**
 * One run of the announce-new-members cron (src/app/api/cron/announce-new-members/route.ts). Claims up to
 * NEW_MEMBER_BATCH_SIZE eligible new members (newMemberAnnouncedAt, a guarded updateMany per member, so a member is
 * announced at most once even if two runs overlap), then writes/updates the bell rows and sends the pushes that
 * planNewMemberAlerts decides for up to NEW_MEMBER_MAX_RECIPIENTS recipients. Members are claimed before anything is
 * sent and nothing is retried: a fan-out failure is logged and those members are simply not announced.
 */
export async function announceNewMembers(now = new Date()) {
  const candidates = await prisma.user.findMany({
    where: newMemberCandidateWhere(now),
    orderBy: { onboardedAt: "asc" },
    take: NEW_MEMBER_BATCH_SIZE,
    select: { id: true, name: true },
  });
  const claimed: typeof candidates = [];
  for (const member of candidates) {
    const result = await prisma.user.updateMany({
      where: { id: member.id, newMemberAnnouncedAt: null },
      data: { newMemberAnnouncedAt: now },
    });
    if (result.count === 1) claimed.push(member);
  }
  if (claimed.length === 0) return { members: 0, rows: 0, pushes: 0 };

  try {
    const recipients = await prisma.user.findMany({
      where: newMemberRecipientWhere(now),
      orderBy: { lastSeenAt: "desc" },
      take: NEW_MEMBER_MAX_RECIPIENTS,
      select: { id: true, newMemberPushAt: true },
    });
    if (recipients.length === 0) return { members: claimed.length, rows: 0, pushes: 0 };
    const memberIds = claimed.map((m) => m.id);
    const recipientIds = recipients.map((r) => r.id);

    const [blocks, openRows] = await Promise.all([
      prisma.block.findMany({
        where: {
          OR: [
            { blockerId: { in: memberIds }, blockedId: { in: recipientIds } },
            { blockerId: { in: recipientIds }, blockedId: { in: memberIds } },
          ],
        },
        select: { blockerId: true, blockedId: true },
      }),
      prisma.notification.findMany({
        where: {
          recipientId: { in: recipientIds },
          type: "NEW_MEMBER_JOINED",
          readAt: null,
          createdAt: { gte: new Date(now.getTime() - NEW_MEMBER_COALESCE_MS) },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, recipientId: true, messageData: true },
      }),
    ]);
    const openByRecipient = new Map<string, { id: string; messageData: string | null }>();
    for (const row of openRows) {
      if (!openByRecipient.has(row.recipientId)) openByRecipient.set(row.recipientId, row);
    }

    const plan = planNewMemberAlerts({
      // Newest first: the newest member a recipient may see is the name on their row.
      members: [...claimed].reverse(),
      recipients,
      blockedPairs: new Set(blocks.map((b) => blockPairKey(b.blockerId, b.blockedId))),
      openRows: openByRecipient,
      now,
    });

    if (plan.creates.length > 0) {
      await prisma.notification.createMany({
        data: plan.creates.map((c) => ({
          recipientId: c.recipientId,
          actorId: c.actorId,
          type: "NEW_MEMBER_JOINED" as const,
          messageData: newMemberMessageData(c.others),
        })),
      });
    }
    // A digest moves to the top of the bell with its newest name and count.
    for (const group of groupByActorAndCount(plan.updates)) {
      await prisma.notification.updateMany({
        where: { id: { in: group.map((u) => u.rowId) }, readAt: null },
        data: { actorId: group[0].actorId, messageData: newMemberMessageData(group[0].others), createdAt: now },
      });
    }

    // Claim each push before sending, guarded on the cooldown, so an overlapping run can't push the same person twice.
    let pushes = 0;
    if (plan.pushes.length > 0) {
      const pushCutoff = new Date(now.getTime() - NEW_MEMBER_PUSH_COOLDOWN_MS);
      const nameById = new Map(claimed.map((m) => [m.id, m.name]));
      for (const group of groupByActorAndCount(plan.pushes)) {
        const ids = group.map((p) => p.recipientId);
        const claimedPush = await prisma.user.findMany({
          where: { id: { in: ids }, OR: [{ newMemberPushAt: null }, { newMemberPushAt: { lte: pushCutoff } }] },
          select: { id: true },
        });
        const pushIds = claimedPush.map((u) => u.id);
        if (pushIds.length === 0) continue;
        await prisma.user.updateMany({
          where: { id: { in: pushIds }, OR: [{ newMemberPushAt: null }, { newMemberPushAt: { lte: pushCutoff } }] },
          data: { newMemberPushAt: now },
        });
        const { actorId, others } = group[0];
        await sendFcmActivityToUsers(pushIds, (locale) => ({
          title: nameOrSomeone(nameById.get(actorId), locale),
          body: newMemberPushBody(others, locale),
          type: "NEW_MEMBER_JOINED",
          url: newMemberHref(actorId, others),
        }));
        pushes += pushIds.length;
      }
    }

    const touched = [...plan.creates, ...plan.updates].map((r) => r.recipientId);
    await publishEvents(touched.map((id) => ({ channel: REALTIME_CHANNELS.navBadges(id), event: "changed" })));
    return { members: claimed.length, rows: touched.length, pushes };
  } catch (err) {
    console.error("[new-member-alerts] fan-out failed", err);
    await captureError(err, { action: "announceNewMembers", members: claimed.map((m) => m.id) });
    return { members: claimed.length, rows: 0, pushes: 0, failed: true };
  }
}
