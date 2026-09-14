import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { getMuseFeed } from "@/app/actions/muse";
import { MuseFeed } from "@/components/muse-feed";

export default async function MusePage() {
  const me = await getOnboardedUserOrRedirect();
  const { items, nextCursor } = await getMuseFeed();

  return <MuseFeed initialItems={items} initialCursor={nextCursor} currentUserId={me.id} />;
}
