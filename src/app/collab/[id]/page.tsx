import { notFound } from "next/navigation";
import Link from "next/link";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { getHiddenPeerIds } from "@/lib/hidden-chats";
import { BackButton } from "@/components/back-button";
import { TrustBadge } from "@/components/trust-badge";
import { UserLink } from "@/components/user-link";
import { ReportTrigger } from "@/components/report-form";
import { CollabParticipantButton } from "@/components/collab-participant-button";
import { CollabParticipantManager } from "@/components/collab-participant-manager";
import { CollabJoinRequestManager } from "@/components/collab-join-request-manager";
import { CollabInviteManager } from "@/components/collab-invite-manager";
import { CollabInviteResponse } from "@/components/collab-invite-response";
import { CollabSessionRoom } from "@/components/collab-session-room";
import { CollabAddToCalendar } from "@/components/collab-add-to-calendar";
import { PollSection } from "@/components/poll-section";
import { CollabOneOffSession } from "@/components/poll-time";
import { getCollabPollAccess, loadPollViews } from "@/lib/polls-data";
import { upcomingOneOffSession } from "@/lib/polls";
import { CloseCollabButton } from "@/components/close-collab-button";
import { DeleteCollabButton } from "@/components/delete-collab-button";
import { ChatThread } from "@/components/chat-thread";
import { PostConnectPopover } from "@/components/post-connect-popover";
import { SubscribeButton } from "@/components/subscribe-button";
import { getAuthorEngagementStatus, engagementStatusFor } from "@/lib/engagement-status";
import { isCollabAdmin, canViewCollab, hasLiveCollabSession } from "@/lib/collab-permissions";
import { splitVisibleInvites } from "@/lib/collab-circle-invite";
import { getOwnedCircleOptions } from "@/lib/collab-circle-options";
import { countryName } from "@/lib/i18n/country-names";
import { vocabName } from "@/lib/i18n/language-names";
import { aroundPlaceholder, plural } from "@/lib/i18n/locales";
import { getDictionary, getLocale } from "@/lib/i18n/server";

export default async function CollabDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { id } = await params;
  const locale = await getLocale();
  const dictionary = await getDictionary();
  const t = dictionary.collab;
  const [byBefore, byAfter] = aroundPlaceholder(t.board.by, "name");

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

  const isParticipant = collab.participants.length > 0;

  // Fetched before the visibility gate below — an invitee who isn't a
  // participant yet still needs to reach this page to see the accept/
  // decline banner (see canViewCollab).
  const myInvite =
    !isParticipant && collab.visibility === "PRIVATE"
      ? await prisma.collabInvite.findFirst({
          where: { collabId: collab.id, inviteeId: me.id, status: "PENDING" },
          include: { inviter: { select: { name: true } } },
        })
      : null;

  if (!canViewCollab(collab, isParticipant, me, !!myInvite)) notFound();

  // Someone in the session right now (same staleness cutoff as
  // getCollabSessionParticipants): the invite banner says so, since accepting
  // is all that stands between the invitee and the Join button below.
  const inviteeSeesLiveSession = myInvite ? await hasLiveCollabSession(collab.id) : false;

  const engagement = engagementStatusFor(
    await getAuthorEngagementStatus(me.id, [collab.author.id]),
    collab.author.id,
  );

  const isOwner = collab.authorId === me.id;
  const canModerate = isCollabAdmin(collab, collab.participants[0] ?? null, me);
  const canJoinSession = isParticipant || isOwner;

  // Polls: anyone who can see a PUBLIC collab sees them; a PRIVATE one's, only its participants (not invitees yet).
  const pollAccess = await getCollabPollAccess(collab, me);
  const polls = pollAccess.canView ? await loadPollViews({ collabId: collab.id }, me, pollAccess) : [];
  const oneOffSessionAt = upcomingOneOffSession(collab.oneOffSessionAt, new Date());

  const allParticipants = canModerate
    ? await prisma.collabParticipant.findMany({
        where: { collabId: collab.id },
        orderBy: { joinedAt: "asc" },
        include: { user: { select: { id: true, name: true, username: true, avatarUrl: true } } },
      })
    : [];

  const pendingJoinRequests =
    canModerate && collab.visibility === "PUBLIC"
      ? await prisma.collabJoinRequest.findMany({
          where: { collabId: collab.id, status: "PENDING" },
          orderBy: { createdAt: "asc" },
          include: { user: { select: { id: true, name: true, username: true, avatarUrl: true } } },
        })
      : [];

  const collabInvites =
    canModerate && collab.visibility === "PRIVATE"
      ? await prisma.collabInvite.findMany({
          where: { collabId: collab.id },
          orderBy: { createdAt: "asc" },
          include: { invitee: { select: { id: true, name: true, username: true, avatarUrl: true } } },
        })
      : [];

  // The organizer's accepted connections: invite candidates, and people this
  // viewer may see by name in the Invited list (splitVisibleInvites).
  const acceptedConnectionUsers =
    canModerate && collab.visibility === "PRIVATE"
      ? (
          await prisma.connection.findMany({
            where: { status: "ACCEPTED", OR: [{ requesterId: me.id }, { targetId: me.id }] },
            include: {
              requester: { select: { id: true, name: true } },
              target: { select: { id: true, name: true } },
            },
          })
        ).map((c) => (c.requesterId === me.id ? c.target : c.requester))
      : [];

  // Invites sent from a Circle aren't marked as such, so an admin sees an
  // invitee by name only if they sent that invite, it was accepted, or they
  // already know the person (connected, or in a Circle together); the rest
  // are just counted. Keeps a co-admin from reading the member list of
  // someone else's private Circle off this page.
  const { visible: visibleInvites, hiddenCount: hiddenInviteCount } = await (async () => {
    const unknownIds = collabInvites
      .filter((i) => i.inviterId !== me.id && i.status !== "ACCEPTED")
      .map((i) => i.inviteeId);
    const knownIds = new Set(acceptedConnectionUsers.map((u) => u.id));
    if (unknownIds.length > 0) {
      const shared = await prisma.circleMembership.findMany({
        where: {
          userId: { in: unknownIds.filter((id) => !knownIds.has(id)) },
          circle: { members: { some: { userId: me.id } } },
        },
        select: { userId: true },
      });
      for (const row of shared) knownIds.add(row.userId);
    }
    return splitVisibleInvites(collabInvites, me.id, knownIds);
  })();

  // Candidates for inviting more people — the organizer's accepted
  // connections, minus anyone already a participant or already invited.
  const inviteCandidates =
    canModerate && collab.visibility === "PRIVATE"
      ? await (async () => {
          const excludeIds = new Set([
            ...allParticipants.map((p) => p.userId),
            ...collabInvites.map((i) => i.inviteeId),
            ...(await getHiddenPeerIds(me.id)),
          ]);
          return acceptedConnectionUsers
            .filter((u) => !excludeIds.has(u.id))
            .map((u) => ({ value: u.id, label: u.name ?? t.form.unknown }));
        })()
      : [];

  // Circles whose members can be invited in one go — only ones this viewer
  // created (see expandCircleInvites), whatever their collab role.
  const circleCandidates =
    canModerate && collab.visibility === "PRIVATE"
      ? await getOwnedCircleOptions(me.id, locale, t.invites.circleMembers)
      : [];

  const myPendingJoinRequest =
    !isParticipant && !canModerate && collab.visibility === "PUBLIC"
      ? await prisma.collabJoinRequest.findUnique({
          where: { collabId_userId: { collabId: collab.id, userId: me.id } },
        })
      : null;

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
            select: {
              id: true,
              mediaType: true,
              mediaUrl: true,
              mediaThumbnailUrl: true,
              embedProvider: true,
              embedId: true,
              caption: true,
            },
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
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-xs font-medium text-teal">
            {vocabName(collab.type, dictionary.vocab.collabTypes)}
          </span>
          {collab.visibility === "PRIVATE" && (
            <span className="rounded-full bg-line px-2.5 py-0.5 text-xs font-medium text-foreground-soft">
              {t.board.private}
            </span>
          )}
        </div>
        <span className="break-words text-xs text-foreground-soft">
          {collab.worldwide
            ? t.board.worldwide
            : collab.countries.map((country) => countryName(country, locale)).join(dictionary.ui.listSeparator)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 dir="auto" className="min-w-0 break-words text-2xl font-semibold">{collab.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {(isOwner || isParticipant || collab.visibility === "PUBLIC") && (
            <CollabParticipantButton
              collabId={collab.id}
              isParticipant={isParticipant}
              isOwner={isOwner}
              hasPendingRequest={!!myPendingJoinRequest}
            />
          )}
          {canModerate && (
            <Link
              href={`/collab/${collab.id}/edit`}
              className="rounded-lg border border-line px-4 py-1.5 text-sm text-foreground-soft hover:border-accent hover:text-foreground"
            >
              {t.board.edit}
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

      <p dir="auto" className="mt-2 break-words text-sm text-foreground-soft">{collab.description}</p>

      {canJoinSession && collab.nextSessionAt && collab.scheduleTime && (
        <div className="mt-3">
          <CollabAddToCalendar
            collabId={collab.id}
            title={collab.title}
            description={collab.description}
            scheduleDays={collab.scheduleDays}
            scheduleTime={collab.scheduleTime}
            nextSessionAt={collab.nextSessionAt.toISOString()}
          />
        </div>
      )}

      {canJoinSession && oneOffSessionAt && (
        <div className="mt-3">
          <CollabOneOffSession
            collabId={collab.id}
            title={collab.title}
            description={collab.description}
            startAt={oneOffSessionAt.toISOString()}
          />
        </div>
      )}

      {myInvite && (
        <div className="mt-3">
          <CollabInviteResponse
            inviteId={myInvite.id}
            inviterName={myInvite.inviter.name}
            sessionLive={inviteeSeesLiveSession}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {byBefore.trim() && <span className="text-xs text-foreground-soft">{byBefore.trim()}</span>}
          <UserLink
            userId={collab.author.id}
            name={collab.author.name}
            username={collab.author.username}
            avatarUrl={collab.author.avatarUrl}
            avatarSize={18}
            className="text-xs font-medium"
          />
          {byAfter.trim() && <span className="text-xs text-foreground-soft">{byAfter.trim()}</span>}
          <TrustBadge band={collab.author.trustBand} />
          <span className="text-xs text-foreground-soft">
            · {plural(locale, t.board.participants, collab._count.participants)}
          </span>
          {collab.status === "CLOSED" && (
            <span className="rounded-full bg-line px-2 py-0.5 text-[0.6875rem] text-foreground-soft">
              {t.board.closed}
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
        <CollabSessionRoom
          collabId={collab.id}
          canJoin={canJoinSession}
          canStart={canModerate}
          hasSessionRoom={!!collab.roomName}
          title={collab.title}
          conversationId={collab.conversationId}
          startOptions={
            canModerate && collab.visibility === "PRIVATE"
              ? { candidates: inviteCandidates, circleCandidates }
              : null
          }
        />
      </div>

      {pollAccess.canView && (
        <PollSection collabId={collab.id} polls={polls} canCreate={pollAccess.canCreate && collab.status === "OPEN"} />
      )}

      {canModerate && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
            {t.detail.participantsHeading}
          </h2>
          <p className="mt-1 text-xs text-foreground-soft">{t.detail.coAdminNote}</p>
          <div className="mt-3">
            <CollabParticipantManager collabId={collab.id} participants={allParticipants} />
          </div>
        </div>
      )}

      {canModerate && collab.visibility === "PUBLIC" && (
        <CollabJoinRequestManager requests={pendingJoinRequests} />
      )}

      {canModerate && collab.visibility === "PRIVATE" && (
        <CollabInviteManager
          collabId={collab.id}
          invites={visibleInvites.map((i) => ({ id: i.id, status: i.status, invitee: i.invitee }))}
          totalCount={collabInvites.length}
          hiddenCount={hiddenInviteCount}
          candidates={inviteCandidates}
          circleCandidates={circleCandidates}
        />
      )}

      <div className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
          {t.detail.chatHeading}
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
                name: m.user.name ?? dictionary.messages.fallback.unknown,
                username: m.user.username,
                avatarUrl: m.user.avatarUrl,
                lastReadAt: m.lastReadAt,
              }))}
            />
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-line p-4 text-sm text-foreground-soft">
            {t.detail.chatLocked}
          </p>
        )}
      </div>
    </div>
  );
}
