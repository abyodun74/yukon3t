import { notFound } from "next/navigation";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { ChatThread } from "@/components/chat-thread";
import { BackButton } from "@/components/back-button";
import { CallButton } from "@/components/call-button";
import { CopyInviteLinkButton } from "@/components/copy-invite-link-button";
import { GroupNameEditor } from "@/components/group-name-editor";
import { GroupDiscoverableToggle } from "@/components/group-discoverable-toggle";
import { AddGroupMembersButton } from "@/components/add-group-members-button";
import { LeaveGroupButton } from "@/components/leave-group-button";
import { JoinRequestButton } from "@/components/join-request-button";
import { JoinRequestList } from "@/components/join-request-list";
import { UserLink } from "@/components/user-link";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { id } = await params;

  const [membership, conversation] = await Promise.all([
    prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: me.id } },
    }),
    prisma.conversation.findUnique({
      where: { id },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, username: true, avatarUrl: true } } },
        },
      },
    }),
  ]);
  if (!conversation) notFound();

  // Not a member: only groups can be joined via their shared link — DMs stay invite-only.
  if (!membership) {
    if (!conversation.isGroup) notFound();

    const myRequest = await prisma.groupJoinRequest.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: me.id } },
    });

    return (
      <div className="mx-auto max-w-lg px-4 py-14">
        <BackButton fallbackHref="/messages" />
        <h1 className="mt-4 text-2xl font-semibold">{conversation.name ?? "Group"}</h1>
        <p className="mt-1 text-sm text-foreground-soft">
          You&apos;re not a member of this group yet.
        </p>
        <div className="mt-6">
          <JoinRequestButton
            conversationId={id}
            status={
              myRequest?.status === "PENDING" || myRequest?.status === "DECLINED"
                ? myRequest.status
                : "NONE"
            }
          />
        </div>
      </div>
    );
  }

  const other = conversation.members.find((m) => m.user.id !== me.id)?.user;
  const conversationLabel = conversation.isGroup
    ? (conversation.name ?? "Group")
    : (other?.name ?? "Conversation");
  const members = conversation.members.map((m) => ({
    userId: m.user.id,
    name: m.user.name ?? "Unknown",
    username: m.user.username,
    avatarUrl: m.user.avatarUrl,
    lastReadAt: m.lastReadAt,
  }));

  const pendingRequests =
    conversation.isGroup && conversation.createdById === me.id
      ? await prisma.groupJoinRequest.findMany({
          where: { conversationId: id, status: "PENDING" },
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
        })
      : [];

  // Only the creator can add members, and only their accepted connections
  // who aren't already in the group are valid candidates — same rule
  // addGroupMembers enforces server-side.
  const memberCandidates =
    conversation.isGroup && conversation.createdById === me.id
      ? await (async () => {
          const memberIds = new Set(members.map((m) => m.userId));
          const accepted = await prisma.connection.findMany({
            where: { status: "ACCEPTED", OR: [{ requesterId: me.id }, { targetId: me.id }] },
            include: {
              requester: { select: { id: true, name: true } },
              target: { select: { id: true, name: true } },
            },
          });
          return accepted
            .map((c) => (c.requesterId === me.id ? c.target : c.requester))
            .filter((u) => !memberIds.has(u.id))
            .map((u) => ({ value: u.id, label: u.name ?? "Unknown" }));
        })()
      : [];

  // Deliberately a plain read, no delivered/read mutation here: Next.js
  // prefetches <Link> targets that are merely visible in a list (e.g. the
  // conversation link on /messages), which would silently mark messages
  // "read" before the user ever opened the thread. Marking read only
  // happens client-side, in ChatThread, after the component actually
  // mounts in a real browser — never during SSR/prefetch.
  const messages = await prisma.message.findMany({
    where: {
      conversationId: id,
      moderationStatus: { not: "REMOVED" },
      NOT: { deletedForUserIds: { has: me.id } },
    },
    orderBy: { createdAt: "asc" },
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
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <BackButton fallbackHref="/messages" />
      <div className="flex items-center justify-between gap-2">
        {conversation.isGroup ? (
          <GroupNameEditor
            conversationId={id}
            name={conversationLabel}
            canEdit={conversation.createdById === me.id}
          />
        ) : other ? (
          <UserLink
            userId={other.id}
            name={other.name}
            username={other.username}
            avatarUrl={other.avatarUrl}
            avatarSize={32}
            className="text-lg font-semibold"
          />
        ) : (
          <h1 className="text-lg font-semibold">{conversationLabel}</h1>
        )}
        <div className="flex shrink-0 items-center gap-2">
          {!conversation.isGroup && other && (
            <CallButton calleeId={other.id} calleeName={other.name ?? "them"} />
          )}
          {conversation.isGroup && (
            <>
              {conversation.createdById === me.id && (
                <GroupDiscoverableToggle
                  conversationId={id}
                  discoverable={conversation.discoverable}
                />
              )}
              <CopyInviteLinkButton conversationId={id} />
              <LeaveGroupButton conversationId={id} />
            </>
          )}
        </div>
      </div>
      {conversation.createdById === me.id && (
        <AddGroupMembersButton conversationId={id} candidates={memberCandidates} />
      )}
      {pendingRequests.length > 0 && (
        <div className="mt-4">
          <JoinRequestList
            requests={pendingRequests.map((r) => ({ id: r.id, name: r.user.name ?? "Unknown" }))}
          />
        </div>
      )}
      <div className="mt-4">
        <ChatThread
          conversationId={id}
          initialMessages={messages}
          currentUserId={me.id}
          isGroup={conversation.isGroup}
          conversationLabel={conversationLabel}
          members={members}
        />
      </div>
    </div>
  );
}
