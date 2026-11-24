import { requireGiftsUser } from "@/lib/gift-gate";
import { GiftHistoryView } from "@/components/gift-history-view";

// The signed-in person's gift history (sent / received). Same gate as the marketplace.
export default async function GiftHistoryPage() {
  await requireGiftsUser();
  return <GiftHistoryView />;
}
