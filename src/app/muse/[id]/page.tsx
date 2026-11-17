import { notFound } from "next/navigation";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { getMuseById } from "@/app/actions/muse";
import { MuseFeed } from "@/components/muse-feed";
import { parseFocusCommentId } from "@/lib/muse-comment-threads";
import { getFeedOrder } from "@/lib/feed-order-server";
import { permalinkRotationCursor } from "@/lib/feed-rotation";

/**
 * Shareable permalink for a single Muse (see recordMuseShare/shareMuse in
 * muse-feed.tsx) — /muse itself has no per-item URL, so a shared link needs
 * its own route. Reuses MuseFeed exactly as /muse's own page does, just
 * seeded with this one Muse as the sole initial item, so scrolling past it
 * continues into the normal feed rather than dead-ending at one video. In the
 * default rotated order that is the current 15-minute mix from its top,
 * without this Muse (permalinkRotationCursor); with the Latest switch on,
 * initialCursor is this Muse's own id, so it resumes newest first from here
 * (getMuseFeed's id-cursor semantics).
 */
export default async function MusePermalinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ comment?: string | string[] }>;
}) {
  const { id } = await params;
  // ?comment=<id>: a comment / reply notification (museCommentHref) opens the comments on that thread. The thread is
  // loaded by getMuseCommentThread under the viewer's own visibility rules, so an id here grants nothing.
  const focusCommentId = parseFocusCommentId((await searchParams).comment);
  const me = await getOnboardedUserOrRedirect();
  const [{ item }, order] = await Promise.all([getMuseById(id), getFeedOrder()]);
  if (!item) notFound();
  const initialCursor = order === "mixed" ? permalinkRotationCursor(item.id) : item.id;

  return (
    <MuseFeed initialItems={[item]} initialCursor={initialCursor} currentUserId={me.id} focusCommentId={focusCommentId} />
  );
}
