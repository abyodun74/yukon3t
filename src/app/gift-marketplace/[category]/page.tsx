import { notFound } from "next/navigation";
import { requireGiftsUser } from "@/lib/gift-gate";
import { loadGiftMarketplace } from "@/lib/gift-market-data";
import { categoryFromSlug } from "@/lib/gift-market";
import { GiftMarketplace } from "@/components/gift-marketplace";

// One marketplace category (/gift-marketplace/love-romance ...). Same gate as the marketplace home.
export default async function GiftMarketplaceCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const user = await requireGiftsUser();
  const category = categoryFromSlug((await params).category);
  if (!category) notFound();
  const data = await loadGiftMarketplace(user.id);
  return <GiftMarketplace gifts={data.gifts} initialFavorites={data.favorites} initialBalance={data.coinBalance} category={category} />;
}
