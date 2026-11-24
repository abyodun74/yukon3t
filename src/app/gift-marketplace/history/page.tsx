import { notFound } from "next/navigation";
import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { giftsEnabledFor } from "@/lib/gifts";
import { GiftHistoryView } from "@/components/gift-history-view";

// The signed-in person's gift history (sent / received). Same gate as the marketplace.
export default async function GiftHistoryPage() {
  const user = await getSessionUserOrRedirect();
  if (!giftsEnabledFor(user)) notFound();
  return <GiftHistoryView />;
}
