import { WifiOff } from "lucide-react";

export const metadata = {
  title: "You're offline — YuKon3t",
};

// Static, session-independent fallback page. The service worker serves
// this straight from cache whenever a page navigation fails due to no
// network connection, so it must not depend on any dynamic data —
// and, critically, it must not depend on client-side JS hydrating
// either: this page's own JS chunk is generally NOT cached (it would
// only get cached by visiting /offline while online, which normally
// never happens), so a "use client" retry button's onClick would
// silently never fire. A plain <a href> re-navigates via the browser
// natively, no JS required, and still goes through the service
// worker's normal network-first/offline-fallback handling either way.
export default function OfflinePage() {
  return (
    <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <WifiOff className="h-10 w-10 text-foreground-soft" aria-hidden />
      <h1 className="text-xl font-semibold text-foreground">You&rsquo;re offline</h1>
      <p className="text-foreground-soft">
        This page needs an internet connection. Check your connection and try again — anything
        you already had open should still be there.
      </p>
      <a
        href="/"
        className="mt-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
      >
        Try again
      </a>
    </div>
  );
}
