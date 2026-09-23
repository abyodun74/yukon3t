import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";

/**
 * The private "Could be better" free-text from the review-prompt gate (see
 * ReviewPromptStatus/AppFeedback in schema.prisma, and review-prompt-gate.tsx)
 * — never a public app-store review, by design: that's the entire point of
 * routing a lukewarm/negative signal here instead of the native store
 * review popup.
 */
export default async function AdminFeedbackPage() {
  const user = await getSessionUserOrRedirect();
  if (!user.isAdmin) redirect("/discover");

  const feedback = await prisma.appFeedback.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { user: { select: { id: true, name: true, username: true, avatarUrl: true } } },
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/admin/moderation" className="text-xs text-foreground-soft hover:text-accent">
        &larr; Moderation queue
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">App feedback</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        {feedback.length === 0
          ? "No feedback submitted yet."
          : `${feedback.length} submission${feedback.length === 1 ? "" : "s"} from the "Could be better" path on the review-prompt gate.`}
      </p>

      <div className="mt-8 space-y-3">
        {feedback.map((f) => (
          <div key={f.id} className="rounded-xl border border-line p-4">
            <div className="flex items-center justify-between gap-3 text-xs text-foreground-soft">
              <Link href={`/u/${f.user.id}`} className="font-medium hover:text-accent">
                {f.user.name ?? f.user.username ?? "Unknown"}
              </Link>
              <span>{f.createdAt.toLocaleString()}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm">{f.content}</p>
          </div>
        ))}
        {feedback.length === 0 && (
          <p className="text-sm text-foreground-soft">Nothing here yet.</p>
        )}
      </div>
    </div>
  );
}
