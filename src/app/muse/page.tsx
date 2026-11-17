import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { getMuseFeed } from "@/app/actions/muse";
import { MuseFeed } from "@/components/muse-feed";
import { FeedOrderToggle } from "@/components/feed-order-toggle";
import { getFeedOrder } from "@/lib/feed-order-server";

export default async function MusePage() {
  const me = await getOnboardedUserOrRedirect();
  // getMuseFeed reads the same switch for its first page: a fresh mix every 15 minutes, or newest first (Latest).
  const [{ items, nextCursor }, order] = await Promise.all([getMuseFeed(), getFeedOrder()]);

  return (
    <MuseFeed
      // A new order is a new list from the top. The rotation bucket is never part of this key: a new mix only comes
      // with a fresh load, never mid-scroll.
      key={order}
      initialItems={items}
      initialCursor={nextCursor}
      currentUserId={me.id}
      headerAccessory={<FeedOrderToggle order={order} surface="muse" />}
    />
  );
}
