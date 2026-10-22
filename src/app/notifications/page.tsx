import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { BackButton } from "@/components/back-button";
import { NotificationRow } from "@/components/notification-row";
import { GroupedNotificationRow } from "@/components/grouped-notification-row";
import { MarkAllReadButton } from "@/components/mark-all-read-button";
import { getHiddenState } from "@/lib/hidden-chats";
import { visibleNotificationWhere } from "@/lib/hidden-chats-rules";
import { circleNotificationVisibleWhere } from "@/lib/circle-visibility";
import { getDictionary } from "@/lib/i18n/server";

export default async function NotificationsPage() {
  const me = await getSessionUserOrRedirect();

  // Rows from a hidden chat, or private ones (message, missed call, screenshot) from a hidden 1:1 peer, are never
  // listed here, including rows created before the chat was hidden. They reappear if the chat is unhidden.
  const hidden = await getHiddenState(me.id);
  const t = (await getDictionary()).pages.notifications;
  // What the rows (client components) need of it.
  const rowLabels = {
    unread: t.unread,
    types: t.types,
    notices: t.notices,
    messagesFrom: t.messagesFrom,
    missedCallsFrom: t.missedCallsFrom,
  };
  const notifications = await prisma.notification.findMany({
    // Also never a row about a PRIVATE Circle the reader isn't a member of (circleNotificationVisibleWhere): to them it
    // doesn't exist, including rows from before they left or before it went private.
    where: { recipientId: me.id, AND: [...visibleNotificationWhere(hidden), circleNotificationVisibleWhere(me.id)] },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      actor: { select: { id: true, name: true, avatarUrl: true } },
      circle: { select: { slug: true, visibility: true } },
      collab: { select: { id: true } },
      channel: { select: { slug: true } },
    },
  });

  // Opening this page does NOT mark anything read. A notification clears
  // only when it's actually opened — tapping its row (NotificationRow /
  // GroupedNotificationRow), tapping its push notification, or visiting
  // the page it leads to (markReadByTarget) — so the bell badge keeps
  // counting the ones the reader hasn't looked at yet. "Mark all as read"
  // below is the one deliberate way to clear the rest in a single tap.
  // MISSED_CALL and MESSAGE collapse into one tally row per (type, actor,
  // conversation) instead of listing every call/message as its own line —
  // three missed calls from the same person is one useful fact ("call them
  // back"), not three things to individually dismiss. Every other type
  // (likes, comments, connection requests, ...) stays one row per event,
  // since those are each a single discrete thing worth seeing on its own.
  // conversationId is folded into the key (not just actorId) so a person
  // you both DM directly and share a group with still gets a separate tally
  // for each thread, rather than one merged row that can only link to one
  // of them. Notifications already arrive sorted newest-first, so the first
  // occurrence of a key is always its latest timestamp, and building the
  // display list by walking that same order (pushing a group only once, at
  // its first/most-recent occurrence) needs no separate re-sort afterward.
  type Notif = (typeof notifications)[number];
  type GroupedItem = {
    kind: "grouped";
    key: string;
    type: "MISSED_CALL" | "MESSAGE";
    count: number;
    ids: string[];
    latestCreatedAt: Date;
    anyUnread: boolean;
    actor: Notif["actor"];
    conversationId: string | null;
  };
  type Item = { kind: "single"; notification: Notif } | GroupedItem;

  const groups = new Map<string, GroupedItem>();
  const items: Item[] = [];

  for (const n of notifications) {
    if (n.type === "MISSED_CALL" || n.type === "MESSAGE") {
      const key = `${n.type}:${n.actorId}:${n.conversationId ?? ""}`;
      const existing = groups.get(key);
      if (existing) {
        existing.count += 1;
        existing.ids.push(n.id);
        if (!n.readAt) existing.anyUnread = true;
        continue;
      }
      const grouped: GroupedItem = {
        kind: "grouped",
        key,
        type: n.type,
        count: 1,
        ids: [n.id],
        latestCreatedAt: n.createdAt,
        anyUnread: !n.readAt,
        actor: n.actor,
        conversationId: n.conversationId,
      };
      groups.set(key, grouped);
      items.push(grouped);
    } else {
      items.push({ kind: "single", notification: n });
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <BackButton />

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t.title}</h1>
        {notifications.some((n) => !n.readAt) && <MarkAllReadButton label={t.markAllRead} />}
      </div>

      <div className="mt-6 space-y-1">
        {items.map((item, i) =>
          item.kind === "grouped" ? (
            <GroupedNotificationRow
              key={item.key}
              type={item.type}
              count={item.count}
              ids={item.ids}
              latestCreatedAt={item.latestCreatedAt}
              unread={item.anyUnread}
              actor={item.actor}
              conversationId={item.conversationId}
              index={i}
              labels={rowLabels}
            />
          ) : (
            <NotificationRow key={item.notification.id} notification={item.notification} index={i} labels={rowLabels} />
          ),
        )}
        {notifications.length === 0 && (
          <p className="text-sm text-foreground-soft">
            {t.empty}
          </p>
        )}
      </div>
    </div>
  );
}
