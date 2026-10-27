import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { MarkDelivered } from "@/components/mark-delivered";
import { MessagesInboxList } from "@/components/messages-inbox-list";
import { MessagesQuickActions } from "@/components/messages-quick-actions";
import { MessagesHeading } from "@/components/messages-heading";
import { getInboxItems } from "@/lib/inbox-items";
import { getDictionary } from "@/lib/i18n/server";
import { GuestGatedScreen } from "@/components/guest-preview";

export default async function MessagesPage() {
  const me = await getOnboardedUserOrRedirect();
  // Members only: a guest preview session (src/lib/guest-preview.ts) sees why, and how to join.
  if (me.isGuestPreview) return <GuestGatedScreen kind="messages" />;

  const t = (await getDictionary()).messages;
  const items = await getInboxItems(me.id, "visible", t.fallback);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <MarkDelivered />
      <div id="messages-header" className="flex items-center justify-between">
        <MessagesHeading />
        <div className="flex items-center gap-1">
          <Link
            href="/messages/discover"
            aria-label={t.inbox.discoverGroups}
            title={t.inbox.discoverGroups}
            className="rounded-full p-2 text-foreground-soft hover:bg-line hover:text-accent"
          >
            <Users size={20} />
          </Link>
          <Link
            href="/messages/new"
            aria-label={t.inbox.newGroup}
            title={t.inbox.newGroup}
            className="rounded-full p-2 text-foreground-soft hover:bg-line hover:text-accent"
          >
            <Plus size={20} />
          </Link>
        </div>
      </div>

      <div className="mt-5">
        <MessagesInboxList items={items} />
      </div>

      <MessagesQuickActions />
    </div>
  );
}
