"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Image as ImageIcon, Mic, MessageCircle, Search, Users, Video } from "lucide-react";
import { UserAvatar } from "@/components/user-link";
import { formatInboxTime } from "@/lib/format-date";
import { cn } from "@/lib/utils";

type MediaType = "NONE" | "AUDIO" | "VIDEO" | "IMAGE";

export type InboxItem = {
  id: string;
  label: string;
  isGroup: boolean;
  avatarUrl: string | null;
  last: {
    content: string;
    mediaType: MediaType;
    moderationStatus: "PUBLISHED" | "FLAGGED" | "REMOVED";
    createdAt: Date;
    mine: boolean;
    /** Only rendered for group chats — a DM's preview never needs a name, the row is already that person. */
    senderName: string | null;
  } | null;
  unread: boolean;
};

const MEDIA_PREVIEW: Record<Exclude<MediaType, "NONE">, { icon: typeof ImageIcon; label: string }> = {
  IMAGE: { icon: ImageIcon, label: "Photo" },
  VIDEO: { icon: Video, label: "Video" },
  AUDIO: { icon: Mic, label: "Voice message" },
};

function LastMessagePreview({ last, isGroup }: { last: InboxItem["last"]; isGroup: boolean }) {
  if (!last) return null;
  if (last.moderationStatus !== "PUBLISHED") {
    return <span className="italic">Message under review</span>;
  }
  const media = last.mediaType !== "NONE" ? MEDIA_PREVIEW[last.mediaType] : null;
  const prefix = last.mine ? "You: " : isGroup && last.senderName ? `${last.senderName.split(" ")[0]}: ` : "";
  if (media) {
    const Icon = media.icon;
    return (
      <span className="inline-flex min-w-0 items-center gap-1">
        <Icon size={13} className="shrink-0" />
        <span className="truncate">
          {prefix}
          {last.content ? last.content : media.label}
        </span>
      </span>
    );
  }
  return (
    <span className="truncate">
      {prefix}
      {last.content}
    </span>
  );
}

export function MessagesInboxList({ items }: { items: InboxItem[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) => c.label.toLowerCase().includes(q));
  }, [items, query]);

  return (
    <div>
      <div className="relative">
        <Search
          size={16}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-soft"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search conversations"
          aria-label="Search conversations"
          className="w-full rounded-full border border-line bg-surface py-2.5 pl-10 pr-4 text-sm outline-none focus:border-accent"
        />
      </div>

      <div className="mt-4 flex flex-col">
        {filtered.map((c, i) => (
          <Link
            key={c.id}
            href={`/messages/${c.id}`}
            style={{ "--row-delay": `${Math.min(i, 10) * 30}ms` } as CSSProperties}
            className="inbox-row group flex items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-surface active:scale-[0.99]"
          >
            <div className="relative shrink-0">
              {c.isGroup ? (
                <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-line bg-accent-soft text-accent">
                  <Users size={20} />
                </div>
              ) : (
                <UserAvatar avatarUrl={c.avatarUrl} name={c.label} size={52} />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className={cn("truncate text-[15px]", c.unread ? "font-semibold" : "font-medium")}>
                  {c.label}
                </p>
                {c.last && (
                  <span
                    className={cn(
                      "shrink-0 text-xs",
                      c.unread ? "font-medium text-accent" : "text-foreground-soft",
                    )}
                  >
                    {formatInboxTime(c.last.createdAt)}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <div
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm",
                    c.unread ? "font-medium text-foreground" : "text-foreground-soft",
                  )}
                >
                  {c.last ? (
                    <LastMessagePreview last={c.last} isGroup={c.isGroup} />
                  ) : (
                    <span>No messages yet</span>
                  )}
                </div>
                {c.unread && (
                  <span aria-hidden className="unread-dot h-2.5 w-2.5 shrink-0 rounded-full bg-accent" />
                )}
              </div>
            </div>
          </Link>
        ))}

        {filtered.length === 0 && items.length > 0 && (
          <p className="px-2 py-8 text-center text-sm text-foreground-soft">
            No conversations match &ldquo;{query}&rdquo;.
          </p>
        )}

        {items.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line px-6 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
              <MessageCircle size={20} />
            </div>
            <div>
              <p className="font-medium">No conversations yet</p>
              <p className="mt-1 text-sm text-foreground-soft">
                Connect with someone from Discover first, or join a group.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
