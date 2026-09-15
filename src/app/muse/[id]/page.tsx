import { notFound } from "next/navigation";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { getMuseById } from "@/app/actions/muse";
import { MuseFeed } from "@/components/muse-feed";

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
export default async function MusePermalinkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getOnboardedUserOrRedirect();
  const { item } = await getMuseById(id);
  if (!item) notFound();

  return <MuseFeed initialItems={[item]} initialCursor={item.id} currentUserId={me.id} />;
}
