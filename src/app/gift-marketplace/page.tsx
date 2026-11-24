import { requireGiftsUser } from "@/lib/gift-gate";
import { loadGiftMarketplace } from "@/lib/gift-market-data";
import { GiftMarketplace } from "@/components/gift-marketplace";

// The gift marketplace home. Behind the same gate as every gift surface (giftsEnabledFor: today, site admins only):
// for anyone else, and the guest preview, the page doesn't exist.
export default async function GiftMarketplacePage() {
  const user = await requireGiftsUser();
  const data = await loadGiftMarketplace(user.id);
  return <GiftMarketplace gifts={data.gifts} initialFavorites={data.favorites} initialBalance={data.coinBalance} category={null} />;
}
