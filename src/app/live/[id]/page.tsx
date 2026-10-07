import { notFound } from "next/navigation";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { LiveStreamRoom } from "@/components/live-stream-room";
import { canAccessLiveStream } from "@/lib/live-stream-access";

const VALID_ROLES = ["VIEWER", "GUEST", "COHOST"] as const;

export default async function LivePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ role?: string }>;
}) {
  const { id } = await params;
  const { role } = await searchParams;
  const me = await getOnboardedUserOrRedirect();

  const liveStream = await prisma.liveStream.findUnique({ where: { id } });
  // A Circle-scoped stream is for that Circle's members only — to anyone else it doesn't exist (not even its title).
  if (!liveStream || !(await canAccessLiveStream(liveStream, me))) {
    notFound();
  }

  // From LiveStreamFeedCard's Watch/Guest/Co-host buttons (src/components/
  // live-stream-feed-card.tsx) — never trusted blindly: anything other than
  // the 3 real values just falls back to LiveStreamRoom's own "choosing"
  // screen, same as every other entry point that doesn't pass this at all.
  const initialRole = (VALID_ROLES as readonly string[]).includes(role ?? "")
    ? (role as (typeof VALID_ROLES)[number])
    : undefined;

  return (
    <LiveStreamRoom
      liveStreamId={liveStream.id}
      isHost={me.id === liveStream.hostId}
      title={liveStream.title}
      initiallyEnded={liveStream.status === "ENDED"}
      initialRole={initialRole}
      // A stream started with one specific person can never auto-post its
      // recording — there's no Post visibility tier for "private to exactly
      // one other person," so the "Record & Post" button isn't offered at
      // all for one (requestLiveStreamRecordingPost re-checks this
      // server-side too, regardless of what the client sends).
      recordingAutoPostAvailable={!liveStream.targetUserId}
    />
  );
}
