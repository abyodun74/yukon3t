import Link from "next/link";
import { Hash, Lock, Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import { CreateChannelModal } from "@/components/create-channel-modal";

type ChannelSummary = {
  id: string;
  slug: string;
  name: string;
  type: "TEXT" | "VOICE";
  visibility: "PUBLIC" | "PRIVATE";
};

function ChannelLink({
  circleSlug,
  channel,
  active,
}: {
  circleSlug: string;
  channel: ChannelSummary;
  active: boolean;
}) {
  const Icon = channel.type === "TEXT" ? Hash : Mic;
  return (
    <Link
      href={`/circles/${circleSlug}?channel=${channel.slug}`}
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm",
        active ? "bg-accent-soft text-accent" : "text-foreground-soft hover:bg-line hover:text-foreground",
      )}
    >
      <Icon size={14} className="shrink-0" />
      <span className="truncate">{channel.name}</span>
      {channel.visibility === "PRIVATE" && <Lock size={11} className="ml-auto shrink-0" />}
    </Link>
  );
}

/**
 * Sidebar/tab list of a Circle's channels — `channels` must already be
 * filtered down to what the viewer can access (see canAccessChannel) before
 * reaching this component; it doesn't re-check visibility itself.
 */
export function ChannelList({
  circleId,
  circleSlug,
  channels,
  activeSlug,
  canManage,
}: {
  circleId: string;
  circleSlug: string;
  channels: ChannelSummary[];
  activeSlug: string;
  canManage: boolean;
}) {
  const textChannels = channels.filter((c) => c.type === "TEXT");
  const voiceChannels = channels.filter((c) => c.type === "VOICE");

  return (
    <div className="space-y-4">
      {textChannels.length > 0 && (
        <div>
          <p className="px-2 text-[10px] font-semibold uppercase tracking-wide text-foreground-soft">
            Text Channels
          </p>
          <div className="mt-1 space-y-0.5">
            {textChannels.map((c) => (
              <ChannelLink key={c.id} circleSlug={circleSlug} channel={c} active={c.slug === activeSlug} />
            ))}
          </div>
        </div>
      )}
      {voiceChannels.length > 0 && (
        <div>
          <p className="px-2 text-[10px] font-semibold uppercase tracking-wide text-foreground-soft">
            Voice Channels
          </p>
          <div className="mt-1 space-y-0.5">
            {voiceChannels.map((c) => (
              <ChannelLink key={c.id} circleSlug={circleSlug} channel={c} active={c.slug === activeSlug} />
            ))}
          </div>
        </div>
      )}
      {canManage && <CreateChannelModal circleId={circleId} />}
    </div>
  );
}
