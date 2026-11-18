import { notFound } from "next/navigation";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { LiveStreamRoom } from "@/components/live-stream-room";
import { giftsEnabledFor } from "@/lib/gifts";
import { challengesEnabledFor } from "@/lib/challenges";
import Link from "next/link";
import { canAccessLiveStream, selectedInviteGoneFor } from "@/lib/live-stream-access";
import { parseNotInvited } from "@/lib/live-audience";
import { getDictionary } from "@/lib/i18n/server";

const VALID_ROLES = ["VIEWER", "GUEST", "COHOST"] as const;

export default async function LivePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ role?: string; invite?: string; notInvited?: string }>;
}) {
  const { id } = await params;
  const { role, invite, notInvited } = await searchParams;
  const me = await getOnboardedUserOrRedirect();

  const liveStream = await prisma.liveStream.findUnique({ where: { id } });
  // A Circle-scoped stream is for that Circle's members only — to anyone else it doesn't exist (not even its title).
  if (!liveStream) notFound();
  if (!(await canAccessLiveStream(liveStream, me))) {
    // "Only the people I selected": someone whose invite was cancelled (or whose live has ended) and who taps the old
    // push or bell row gets a plain note, not a 404. Only for someone who had an invite row and no block with the host
    // or inviter; nothing about the stream is rendered (no title, host, room or token). Everyone else: 404.
    const gone = await selectedInviteGoneFor(liveStream, me.id);
    if (!gone) notFound();
    const t = (await getDictionary()).live;
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <p role="status" className="text-sm text-foreground-soft">
          {t.invite.selectedGone[gone]}
        </p>
        <Link
          href="/home"
          className="mt-4 inline-block rounded-lg border border-line px-3 py-2 text-sm font-medium hover:border-accent hover:text-accent"
        >
          {t.backHome}
        </Link>
      </main>
    );
  }

  // From LiveStreamFeedCard's Watch/Guest/Co-host buttons (src/components/
  // live-stream-feed-card.tsx) — never trusted blindly: anything other than
  // the 3 real values just falls back to LiveStreamRoom's own "choosing"
  // screen, same as every other entry point that doesn't pass this at all.
  const initialRole = (VALID_ROLES as readonly string[]).includes(role ?? "")
    ? (role as (typeof VALID_ROLES)[number])
    : undefined;

  // Digital gifts (src/lib/gifts.ts): effects play for a viewer with gifts on; a gift can be sent to the host when gifts
  // are on for both (createGiftIntent re-checks that the sender is in the stream, blocks, age and the host's rules).
  const giftsOn = giftsEnabledFor(me);
  const host =
    giftsOn && me.id !== liveStream.hostId
      ? await prisma.user.findUnique({
          where: { id: liveStream.hostId },
          select: { id: true, name: true, isAdmin: true, isGuestPreview: true },
        })
      : null;
  const giftHost = host && giftsEnabledFor(host) ? { id: host.id, name: host.name } : null;

  return (
    <LiveStreamRoom
      liveStreamId={liveStream.id}
      isHost={me.id === liveStream.hostId}
      title={liveStream.title}
      initiallyEnded={liveStream.status === "ENDED"}
      initialRole={initialRole}
      // Opened from a stage invite's push or bell row (liveInviteHref): a stale one says why it can't be answered.
      fromInvite={invite === "1"}
      // A stream started with one specific person can never auto-post its
      // recording — there's no Post visibility tier for "private to exactly
      // one other person," so the "Record & Post" button isn't offered at
      // all for one (requestLiveStreamRecordingPost re-checks this
      // server-side too, regardless of what the client sends).
      // The same for "Only the people I selected" (selectedOnly): no Post tier is limited to a hand-picked list.
      recordingAutoPostAvailable={!liveStream.targetUserId && !liveStream.selectedOnly}
      selectedAudience={liveStream.selectedOnly}
      notInvited={me.id === liveStream.hostId ? parseNotInvited(notInvited) : 0}
      giftsEnabled={giftsOn}
      giftHost={giftHost}
      // Challenges (Gift Universe Phase B): the panel and winner moments, only while challengesEnabledFor is on for the
      // viewer; every challenge action re-checks it, and that the viewer is in the stream.
      challengesEnabled={challengesEnabledFor(me)}
    />
  );
}
