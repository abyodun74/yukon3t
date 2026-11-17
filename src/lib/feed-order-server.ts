import { cookies } from "next/headers";
import { FEED_ORDER_COOKIE, parseFeedOrder, type FeedOrder } from "@/lib/feed-rotation";

/** The reader's Home / Muse order: "mixed" (the default, rotated every 15 minutes) unless they turned Latest on. */
export async function getFeedOrder(): Promise<FeedOrder> {
  return parseFeedOrder((await cookies()).get(FEED_ORDER_COOKIE)?.value);
}
