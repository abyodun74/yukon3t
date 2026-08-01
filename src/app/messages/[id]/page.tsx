import { notFound } from "next/navigation";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { ChatThread } from "@/components/chat-thread";
import { BackButton } from "@/components/back-button";
import { CallButton } from "@/components/call-button";
import { CopyInviteLinkButton } from "@/components/copy-invite-link-button";
import { GroupNameEditor } from "@/components/group-name-editor";
import { LeaveGroupButton } from "@/components/leave-group-button";
import { JoinRequestButton } from "@/components/join-request-button";
import { JoinRequestList } from "@/components/join-request-list";

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
          include: { user: { select: { id: true, name: true } } },
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
    include: { reactions: { select: { emoji: true, userId: true } } },
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
        ) : (
          <h1 className="text-lg font-semibold">{conversationLabel}</h1>
        )}
        <div className="flex shrink-0 items-center gap-2">
          {!conversation.isGroup && other && (
            <CallButton calleeId={other.id} calleeName={other.name ?? "them"} />
          )}
          {conversation.isGroup && (
            <>
              <CopyInviteLinkButton conversationId={id} />
              <LeaveGroupButton conversationId={id} />
            </>
          )}
        </div>
      </div>
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
