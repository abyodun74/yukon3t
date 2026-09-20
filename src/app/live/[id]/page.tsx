import { notFound } from "next/navigation";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { LiveStreamRoom } from "@/components/live-stream-room";
import { canAccessLiveStream } from "@/lib/live-stream-access";

export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getOnboardedUserOrRedirect();

  const liveStream = await prisma.liveStream.findUnique({ where: { id } });
  // A Circle-scoped stream is for that Circle's members only — to anyone else it doesn't exist (not even its title).
  if (!liveStream || !(await canAccessLiveStream(liveStream, me))) {
    notFound();
  }

  return (
    <LiveStreamRoom
      liveStreamId={liveStream.id}
      isHost={me.id === liveStream.hostId}
      title={liveStream.title}
      initiallyEnded={liveStream.status === "ENDED"}
    />
  );
}
