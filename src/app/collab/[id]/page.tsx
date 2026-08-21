import { notFound } from "next/navigation";
import Link from "next/link";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { BackButton } from "@/components/back-button";
import { TrustBadge } from "@/components/trust-badge";
import { UserLink } from "@/components/user-link";
import { ReportTrigger } from "@/components/report-form";
import { CollabParticipantButton } from "@/components/collab-participant-button";
import { CollabParticipantManager } from "@/components/collab-participant-manager";
import { CollabSessionRoom } from "@/components/collab-session-room";
import { CloseCollabButton } from "@/components/close-collab-button";
import { DeleteCollabButton } from "@/components/delete-collab-button";
import { ChatThread } from "@/components/chat-thread";
import { PostConnectPopover } from "@/components/post-connect-popover";
import { SubscribeButton } from "@/components/subscribe-button";
import { getAuthorEngagementStatus, engagementStatusFor } from "@/lib/engagement-status";
import { collabTypeLabels } from "@/lib/collab-labels";
import { isCollabAdmin } from "@/lib/collab-permissions";

export default async function CollabDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { id } = await params;

  const collab = await prisma.collabBoardPost.findUnique({
    where: { id },
    include: {
      author: {
        select: { id: true, name: true, username: true, avatarUrl: true, trustBand: true, openToIntents: true },
      },
      participants: { where: { userId: me.id } },
      _count: { select: { participants: true } },
    },
  });
  if (!collab) notFound();

  const engagement = engagementStatusFor(
    await getAuthorEngagementStatus(me.id, [collab.author.id]),
    collab.author.id,
  );

  const isParticipant = collab.participants.length > 0;
  const isOwner = collab.authorId === me.id;
  const canModerate = isCollabAdmin(collab, collab.participants[0] ?? null, me);
  const canJoinSession = isParticipant || isOwner;

  const allParticipants = canModerate
    ? await prisma.collabParticipant.findMany({
        where: { collabId: collab.id },
        orderBy: { joinedAt: "asc" },
        include: { user: { select: { id: true, name: true, username: true, avatarUrl: true } } },
      })
    : [];

  const conversation = collab.conversationId
    ? await prisma.conversation.findUnique({
        where: { id: collab.conversationId },
        include: {
          members: { include: { user: { select: { id: true, name: true, username: true, avatarUrl: true } } } },
        },
      })
    : null;

  // Newest 200 first (not oldest) then reversed for display — otherwise a
  // board past 200 messages would always render the same stuck, oldest
  // slice with no recent messages ever visible.
  const recentMessages = conversation && canJoinSession
    ? await prisma.message.findMany({
        where: {
          conversationId: conversation.id,
          moderationStatus: { not: "REMOVED" },
          NOT: { deletedForUserIds: { has: me.id } },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: {
          reactions: { select: { emoji: true, userId: true } },
          corrections: { include: { author: { select: { id: true, name: true } } } },
          story: {
            select: { id: true, mediaType: true, mediaUrl: true, mediaThumbnailUrl: true, caption: true },
          },
          replyTo: {
            select: {
              id: true,
              content: true,
              mediaType: true,
              deletedForEveryoneAt: true,
              sender: { select: { id: true, name: true } },
            },
          },
        },
      })
    : [];
  const messages = recentMessages.reverse();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <BackButton fallbackHref="/collab" />

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-xs font-medium text-teal">
          {collabTypeLabels[collab.type]}
        </span>
        <span className="break-words text-xs text-foreground-soft">
          {collab.worldwide ? "Worldwide" : collab.countries.join(", ")}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="min-w-0 break-words text-2xl font-semibold">{collab.title}</h1>
        <div className="flex items-center gap-2">
          <CollabParticipantButton
            collabId={collab.id}
            isParticipant={isParticipant}
            isOwner={isOwner}
          />
          {canModerate && (
            <Link
              href={`/collab/${collab.id}/edit`}
              className="rounded-lg border border-line px-4 py-1.5 text-sm text-foreground-soft hover:border-accent hover:text-foreground"
            >
              Edit
            </Link>
          )}
          {collab.status === "OPEN" && (isOwner || me.isAdmin) && (
            <CloseCollabButton collabId={collab.id} />
          )}
          {(isOwner || me.isAdmin) && (
            <DeleteCollabButton collabId={collab.id} isAdminOverride={!isOwner} />
          )}
        </div>
      </div>

      <p className="mt-2 break-words text-sm text-foreground-soft">{collab.description}</p>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-foreground-soft">by</span>
          <UserLink
            userId={collab.author.id}
            name={collab.author.name}
            username={collab.author.username}
            avatarUrl={collab.author.avatarUrl}
            avatarSize={18}
            className="text-xs font-medium"
          />
          <TrustBadge band={collab.author.trustBand} />
          <span className="text-xs text-foreground-soft">
            · {collab._count.participants} participant{collab._count.participants === 1 ? "" : "s"}
          </span>
          {collab.status === "CLOSED" && (
            <span className="rounded-full bg-line px-2 py-0.5 text-[11px] text-foreground-soft">
              Closed
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {collab.author.id !== me.id && (
            <>
              <PostConnectPopover
                targetId={collab.author.id}
                openToIntents={collab.author.openToIntents}
                status={engagement.connectionStatus}
                isRequester={engagement.connectionIsRequester}
                conversationId={engagement.conversationId}
              />
              <SubscribeButton
                targetId={collab.author.id}
                initiallySubscribed={engagement.subscribedByMe}
                variant="icon"
              />
            </>
          )}
          <ReportTrigger
            targetType="COLLAB_POST"
            targetId={collab.id}
            reportedUserId={collab.author.id}
          />
        </div>
      </div>

      <div className="mt-8">
        <CollabSessionRoom collabId={collab.id} canJoin={canJoinSession} />
      </div>

      {canModerate && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
            Participants
          </h2>
          <p className="mt-1 text-xs text-foreground-soft">
            Co-admins get the same management powers as you, except closing this collaboration.
          </p>
          <div className="mt-3">
            <CollabParticipantManager collabId={collab.id} participants={allParticipants} />
          </div>
        </div>
      )}

      <div className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
          Collaboration chat
        </h2>
        {conversation && canJoinSession ? (
          <div className="mt-3">
            <ChatThread
              conversationId={conversation.id}
              initialMessages={messages}
              currentUserId={me.id}
              isGroup
              conversationLabel={collab.title}
              members={conversation.members.map((m) => ({
                userId: m.user.id,
                name: m.user.name ?? "Unknown",
                username: m.user.username,
                avatarUrl: m.user.avatarUrl,
                lastReadAt: m.lastReadAt,
              }))}
            />
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-line p-4 text-sm text-foreground-soft">
            Participate in this collaboration to post photos, videos, and messages here.
          </p>
        )}
      </div>
    </div>
  );
}
