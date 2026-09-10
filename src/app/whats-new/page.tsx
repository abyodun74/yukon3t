import type { Metadata } from "next";
import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { BackButton } from "@/components/back-button";
import { WhatsNewSeenMarker } from "@/components/whats-new-seen-marker";

const title = "What's New on YuKon3t — Latest Features & Updates";
const description =
  "See the newest features on YuKon3t, from Collab Boards to live streaming — a running changelog of what's shipped and what's coming.";

// This page itself calls getSessionUserOrRedirect() below and redirects
// signed-out visitors (including crawlers) to /sign-in before any markup
// renders, so a crawler never actually sees this metadata — it's set for
// consistency/if the gate is ever relaxed. Accordingly this route is
// disallowed in robots.ts and left out of sitemap.ts.
export const metadata: Metadata = {
  title: { absolute: title },
  description,
  openGraph: {
    type: "website",
    url: "/whats-new",
    siteName: "YuKon3t",
    title,
    description,
    images: [{ url: "/icons/icon-512.png", width: 512, height: 512 }],
  },
  twitter: {
    card: "summary",
    title,
    description,
    images: ["/icons/icon-512.png"],
  },
};

export default async function WhatsNewPage() {
  await getSessionUserOrRedirect();

  const announcements = await prisma.announcement.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <BackButton />
      <WhatsNewSeenMarker />

      <h1 className="mt-2 text-2xl font-semibold">What&apos;s new</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        Updates and new features on YuKon3t.
      </p>

      <div className="mt-6 space-y-4">
        {announcements.map((a) => (
          <div key={a.id} className="rounded-xl border border-line p-4">
            <h2 className="break-words font-semibold">{a.title}</h2>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground-soft">{a.body}</p>
            <p className="mt-2 text-xs text-foreground-soft">
              {a.createdAt.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
            </p>
          </div>
        ))}
        {announcements.length === 0 && (
          <p className="text-sm text-foreground-soft">Nothing here yet — check back later.</p>
        )}
      </div>
    </div>
  );
}
