import { notFound } from "next/navigation";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { LiveStreamRoom } from "@/components/live-stream-room";

export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getOnboardedUserOrRedirect();

  const liveStream = await prisma.liveStream.findUnique({ where: { id } });
  if (!liveStream) {
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
