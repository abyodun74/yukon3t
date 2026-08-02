import { WifiOff } from "lucide-react";
import { OfflineRetryButton } from "@/components/offline-retry-button";

export const metadata = {
  title: "You're offline — YuKon3t",
};

// Static, session-independent fallback page. The service worker serves
// this straight from cache whenever a page navigation fails due to no
// network connection, so it must not depend on any dynamic data.
export default function OfflinePage() {
  return (
    <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <WifiOff className="h-10 w-10 text-foreground-soft" aria-hidden />
      <h1 className="text-xl font-semibold text-foreground">You&rsquo;re offline</h1>
      <p className="text-foreground-soft">
        This page needs an internet connection. Check your connection and try again — anything
        you already had open should still be there.
      </p>
      <OfflineRetryButton />
    </div>
  );
}
