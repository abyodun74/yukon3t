import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { BackButton } from "@/components/back-button";
import { NotificationRow } from "@/components/notification-row";
import { MarkAllReadButton } from "@/components/mark-all-read-button";

export default async function NotificationsPage() {
  const me = await getSessionUserOrRedirect();

  const notifications = await prisma.notification.findMany({
    where: { recipientId: me.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      actor: { select: { id: true, name: true, avatarUrl: true } },
      circle: { select: { slug: true } },
      collab: { select: { id: true } },
      channel: { select: { slug: true } },
    },
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <BackButton />

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Notifications</h1>
        {notifications.some((n) => !n.readAt) && <MarkAllReadButton />}
      </div>

      <div className="mt-6 space-y-1">
        {notifications.map((notification, i) => (
          <NotificationRow key={notification.id} notification={notification} index={i} />
        ))}
        {notifications.length === 0 && (
          <p className="text-sm text-foreground-soft">
            Nothing yet — likes, comments, reposts, shares, messages,
            connection requests, and new posts/stories from people you
            subscribe to will show up here.
          </p>
        )}
      </div>
    </div>
  );
}
