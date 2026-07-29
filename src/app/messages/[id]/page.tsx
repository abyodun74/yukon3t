import { notFound } from "next/navigation";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { MessageForm } from "@/components/message-form";
import { cn } from "@/lib/utils";

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
      messages: {
        where: { moderationStatus: { not: "REMOVED" } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!conversation) notFound();

  const other = conversation.members.find((m) => m.user.id !== me.id)?.user;

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-2xl flex-col px-4 py-6">
      <h1 className="text-lg font-semibold">{other?.name ?? "Conversation"}</h1>
      <div className="mt-4 flex-1 space-y-3 overflow-y-auto rounded-xl border border-line p-4">
        {conversation.messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "max-w-[75%] rounded-lg px-3 py-2 text-sm",
              m.senderId === me.id
                ? "ml-auto bg-accent text-accent-ink"
                : "bg-surface",
            )}
          >
            {m.moderationStatus === "PUBLISHED"
              ? m.content
              : "This message is under review."}
          </div>
        ))}
        {conversation.messages.length === 0 && (
          <p className="text-sm text-foreground-soft">
            Say hello — remember, you can only DM after both of you accepted
            the connection request.
          </p>
        )}
      </div>
      <MessageForm conversationId={conversation.id} />
    </div>
  );
}
