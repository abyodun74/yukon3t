import { redirect } from "next/navigation";
import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { ModerationActionForm } from "@/components/moderation-action-form";
import { FlaggedContentActions } from "@/components/flagged-content-actions";

/**
 * What Moderation in the Admin profile can do:
 *  - Reports queue: a member reported a user, post, comment, message, Circle,
 *    or collab post. An admin resolves it by dismissing, warning/suspending/
 *    banning the reported user, or removing the reported content outright
 *    (post/comment/message removed, Circle deleted, collab post closed).
 *  - Flagged content queue: content our automated moderation (see
 *    src/lib/moderation.ts) held back at creation time, before anyone
 *    reported it. An admin reviews it and either publishes it or removes it.
 * Every action writes an AuditLog entry against the content's author/the
 * reported user, so it's always explainable and appealable.
 */
export default async function ModerationQueuePage() {
  const user = await getSessionUserOrRedirect();
  if (!user.isAdmin) redirect("/discover");

  const [open, resolved, flaggedPosts, flaggedComments, flaggedMessages, hiddenComments] = await Promise.all([
    prisma.report.findMany({
      where: { status: { in: ["OPEN", "REVIEWING"] } },
      orderBy: { createdAt: "asc" },
      // Oldest-first plus a generous cap — this is the actionable backlog
      // admins are expected to fully work through, not a "recent" preview
      // like the queues below, so this exists as a blowup circuit-breaker
      // (e.g. a spam wave), not a normal-operation pagination limit.
      take: 200,
      include: {
        reporter: { select: { name: true } },
        reportedUser: { select: { id: true, name: true, status: true } },
      },
    }),
    prisma.report.findMany({
      where: { status: { in: ["RESOLVED", "DISMISSED"] } },
      orderBy: { resolvedAt: "desc" },
      take: 15,
      include: {
        reporter: { select: { name: true } },
        reportedUser: { select: { name: true } },
      },
    }),
    prisma.post.findMany({
      where: { moderationStatus: "FLAGGED" },
      orderBy: { createdAt: "asc" },
      take: 20,
      include: { author: { select: { name: true } } },
    }),
    prisma.comment.findMany({
      where: { moderationStatus: "FLAGGED" },
      orderBy: { createdAt: "asc" },
      take: 20,
      include: { author: { select: { name: true } } },
    }),
    prisma.message.findMany({
      where: { moderationStatus: "FLAGGED" },
      orderBy: { createdAt: "asc" },
      take: 20,
      include: { sender: { select: { name: true } } },
    }),
    // Hidden by a post author/Circle co-admin, not an admin — see hideComment
    // in comments.ts. Unlike a report or a flagged-at-creation item, these
    // never otherwise surface anywhere an admin would see them.
    prisma.comment.findMany({
      where: { moderationStatus: "REMOVED" },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { author: { select: { name: true } } },
    }),
  ]);

  const flaggedCount = flaggedPosts.length + flaggedComments.length + flaggedMessages.length;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Moderation queue</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        Every action here writes a reason to the affected user&apos;s audit
        trail. Target: 95% triaged within 24 hours.
      </p>

      <div className="mt-8 space-y-4">
        {open.map((report) => (
          <div key={report.id} className="rounded-xl border border-line p-4">
            <div className="flex items-center justify-between text-xs text-foreground-soft">
              <span>
                {report.targetType} · reported by {report.reporter.name}
              </span>
              <span>{report.createdAt.toLocaleString()}</span>
            </div>
            <p className="mt-2 text-sm">{report.reason}</p>
            {report.reportedUser && (
              <p className="mt-1 text-xs text-foreground-soft">
                Against: {report.reportedUser.name} ({report.reportedUser.status})
              </p>
            )}
            <ModerationActionForm reportId={report.id} targetType={report.targetType} />
          </div>
        ))}
        {open.length === 0 && (
          <p className="text-sm text-foreground-soft">Queue is clear.</p>
        )}
      </div>

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-foreground-soft">
        Flagged content ({flaggedCount})
      </h2>
      <p className="mt-1 text-xs text-foreground-soft">
        Held back automatically before publishing — no one has reported these,
        they failed our content screen. Review and publish or remove.
      </p>
      <div className="mt-3 space-y-3">
        {flaggedPosts.map((post) => (
          <div key={post.id} className="rounded-lg border border-line p-3">
            <p className="text-xs text-foreground-soft">Post by {post.author.name}</p>
            <p className="mt-1 text-sm">{post.content || "(media post, no caption)"}</p>
            <FlaggedContentActions contentType="POST" contentId={post.id} />
          </div>
        ))}
        {flaggedComments.map((comment) => (
          <div key={comment.id} className="rounded-lg border border-line p-3">
            <p className="text-xs text-foreground-soft">Comment by {comment.author.name}</p>
            <p className="mt-1 text-sm">{comment.content}</p>
            <FlaggedContentActions contentType="COMMENT" contentId={comment.id} />
          </div>
        ))}
        {flaggedMessages.map((message) => (
          <div key={message.id} className="rounded-lg border border-line p-3">
            <p className="text-xs text-foreground-soft">Message from {message.sender.name}</p>
            <p className="mt-1 text-sm">{message.content}</p>
            <FlaggedContentActions contentType="MESSAGE" contentId={message.id} />
          </div>
        ))}
        {flaggedCount === 0 && (
          <p className="text-sm text-foreground-soft">Nothing flagged right now.</p>
        )}
      </div>

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-foreground-soft">
        Hidden comments ({hiddenComments.length})
      </h2>
      <p className="mt-1 text-xs text-foreground-soft">
        Hidden by a post author or Circle co-admin, not reported or auto-flagged. Publish to restore or remove outright.
      </p>
      <div className="mt-3 space-y-3">
        {hiddenComments.map((comment) => (
          <div key={comment.id} className="rounded-lg border border-line p-3">
            <p className="text-xs text-foreground-soft">Comment by {comment.author.name}</p>
            <p className="mt-1 text-sm">{comment.content}</p>
            <FlaggedContentActions contentType="COMMENT" contentId={comment.id} />
          </div>
        ))}
        {hiddenComments.length === 0 && (
          <p className="text-sm text-foreground-soft">No hidden comments right now.</p>
        )}
      </div>

      <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-foreground-soft">
        Recently resolved
      </h2>
      <div className="mt-3 space-y-2">
        {resolved.map((r) => (
          <div key={r.id} className="rounded-lg border border-line p-3 text-xs text-foreground-soft">
            {r.targetType} report against {r.reportedUser?.name ?? "n/a"} — {r.resolutionNote}
          </div>
        ))}
      </div>
    </div>
  );
}
