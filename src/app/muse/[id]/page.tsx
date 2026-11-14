import { notFound } from "next/navigation";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { getMuseById } from "@/app/actions/muse";
import { MuseFeed } from "@/components/muse-feed";
import { parseFocusCommentId } from "@/lib/muse-comment-threads";

/**
 * Shareable permalink for a single Muse (see recordMuseShare/shareMuse in
 * muse-feed.tsx) — /muse itself has no per-item URL, so a shared link needs
 * its own route. Reuses MuseFeed exactly as /muse's own page does, just
 * seeded with this one Muse as the sole initial item; initialCursor is set
 * to this Muse's own id so scrolling past it continues the normal feed
 * (getMuseFeed's cursor semantics: "everything newer than this id" is
 * already past by definition, so this always resumes into whatever comes
 * next chronologically) rather than dead-ending the feed at one video.
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
  const { item } = await getMuseById(id);
  if (!item) notFound();

  return <MuseFeed initialItems={[item]} initialCursor={item.id} currentUserId={me.id} focusCommentId={focusCommentId} />;
}
