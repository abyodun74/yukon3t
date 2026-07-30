import { notFound } from "next/navigation";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { ChatThread } from "@/components/chat-thread";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { id } = await params;

  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: id, userId: me.id } },
  });
  if (!membership) notFound();

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: {
      members: { include: { user: { select: { id: true, name: true } } } },
    },
  });
  if (!conversation) notFound();

  const other = conversation.members.find((m) => m.user.id !== me.id)?.user;

  // Deliberately a plain read, no delivered/read mutation here: Next.js
  // prefetches <Link> targets that are merely visible in a list (e.g. the
  // conversation link on /messages), which would silently mark messages
  // "read" before the user ever opened the thread. Marking read only
  // happens client-side, in ChatThread, after the component actually
  // mounts in a real browser — never during SSR/prefetch.
  const messages = await prisma.message.findMany({
    where: { conversationId: id, moderationStatus: { not: "REMOVED" } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-lg font-semibold">{other?.name ?? "Conversation"}</h1>
      <div className="mt-4">
        <ChatThread
          conversationId={id}
          initialMessages={messages}
          currentUserId={me.id}
          otherUserName={other?.name ?? "them"}
        />
      </div>
    </div>
  );
}
