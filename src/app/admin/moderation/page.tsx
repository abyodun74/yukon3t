import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { ModerationActionForm } from "@/components/moderation-action-form";
import { FlaggedContentActions } from "@/components/flagged-content-actions";
import { AdminSendResetButton } from "@/components/admin-send-reset-button";
import { AdminResendVerificationButton } from "@/components/admin-resend-verification-button";
import { AdminDeletePostButton } from "@/components/admin-delete-post-button";
import { AdminDeleteConversationButton } from "@/components/admin-delete-conversation-button";
import { STUCK_UNVERIFIED_AFTER_MS, RESOLVED_LOGIN_ISSUE_VISIBLE_MS } from "@/lib/login-issues";

// How far back to look for duplicate posts/DM threads — bounds the scan to a
// recent, actionable window rather than the whole table's history.
const DUPLICATE_SCAN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * What Moderation in the Admin profile can do:
 *  - Reports queue: a member reported a user, post, comment, message, Circle,
 *    or collab post. An admin resolves it by dismissing, warning/suspending/
 *    banning the reported user, or removing the reported content outright
 *    (post/comment/message removed, Circle deleted, collab post closed).
 *  - Flagged content queue: content our automated moderation (see
 *    src/lib/moderation.ts) held back at creation time, before anyone
 *    reported it. An admin reviews it and either publishes it or removes it.
 *  - Login issues: accounts locked out, racking up failed passwords, or
 *    stuck unverified — surfaced proactively (not just reachable by
 *    searching /admin/users) so support doesn't depend on the member
 *    knowing to ask.
 * Every action writes an AuditLog entry against the content's author/the
 * reported user, so it's always explainable and appealable.
 */
export default async function ModerationQueuePage() {
  const user = await getSessionUserOrRedirect();
  if (!user.isAdmin) redirect("/discover");

  const now = new Date();

  const [
    open,
    resolved,
    flaggedPosts,
    flaggedComments,
    flaggedMessages,
    hiddenComments,
    lockedUsers,
    failedAttemptUsers,
    unverifiedStuckUsers,
    resolvedLoginIssueUsers,
  ] = await Promise.all([
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
    // Non-ACTIVE/DEACTIVATED accounts (banned, suspended) are deliberately
    // excluded from all three login-issue queries below — that's an
    // intentional moderation block handled via the reports queue above, not
    // an access problem to fix here.
    prisma.user.findMany({
      where: { status: { in: ["ACTIVE", "DEACTIVATED"] }, lockedUntil: { gt: now } },
      orderBy: { lockedUntil: "desc" },
      take: 30,
      select: { id: true, name: true, username: true, email: true, lockedUntil: true },
    }),
    prisma.user.findMany({
      where: {
        status: { in: ["ACTIVE", "DEACTIVATED"] },
        failedLoginAttempts: { gt: 0 },
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
      },
      orderBy: { failedLoginAttempts: "desc" },
      take: 30,
      select: { id: true, name: true, username: true, email: true, failedLoginAttempts: true },
    }),
    prisma.user.findMany({
      where: {
        status: "ACTIVE",
        emailVerified: null,
        createdAt: { lt: new Date(now.getTime() - STUCK_UNVERIFIED_AFTER_MS) },
        // Excludes accounts the resolve-login-issues cron already auto-dismissed
        // after 48h unresolved (src/app/api/cron/resolve-login-issues) — without
        // this, still-unverified-but-dismissed accounts would keep showing here
        // forever, since verifying is what would otherwise naturally clear this
        // bucket (emailVerified stays null either way).
        loginIssueResolvedAt: null,
      },
      orderBy: { createdAt: "asc" },
      take: 30,
      select: { id: true, name: true, username: true, email: true, createdAt: true },
    }),
    prisma.user.findMany({
      where: {
        loginIssueResolvedAt: { gt: new Date(now.getTime() - RESOLVED_LOGIN_ISSUE_VISIBLE_MS) },
      },
      orderBy: { loginIssueResolvedAt: "desc" },
      take: 30,
      select: { id: true, name: true, username: true, email: true, loginIssueResolvedAt: true },
    }),
  ]);

  // A user can rack up a fresh issue after a past one resolved (e.g.
  // resolved a lockout, then got locked out again) — the active queries
  // above are the source of truth for "currently a problem", so drop
  // anyone from "recently resolved" who's still showing up there too.
  const activeIds = new Set([...lockedUsers, ...failedAttemptUsers, ...unverifiedStuckUsers].map((u) => u.id));
  const recentlyResolvedLoginIssueUsers = resolvedLoginIssueUsers.filter((u) => !activeIds.has(u.id));

  const flaggedCount = flaggedPosts.length + flaggedComments.length + flaggedMessages.length;

  // Duplicate posts: same author + identical content within the scan
  // window — grouped in memory rather than a raw GROUP BY so the "keep the
  // earliest, offer to delete the rest" logic stays plain TS.
  const duplicateScanCutoff = new Date(now.getTime() - DUPLICATE_SCAN_WINDOW_MS);
  const recentPosts = await prisma.post.findMany({
    where: { createdAt: { gt: duplicateScanCutoff }, content: { not: "" } },
    orderBy: { createdAt: "asc" },
    take: 1000,
    select: { id: true, authorId: true, content: true, createdAt: true, author: { select: { name: true } } },
  });
  const postGroupsByKey = new Map<string, typeof recentPosts>();
  for (const post of recentPosts) {
    const key = `${post.authorId}::${post.content}`;
    const group = postGroupsByKey.get(key) ?? [];
    group.push(post);
    postGroupsByKey.set(key, group);
  }
  const duplicatePostGroups = [...postGroupsByKey.values()].filter((g) => g.length > 1);

  // Duplicate DM threads: two non-group conversations sharing the exact
  // same pair of members. Keeps whichever has the most recent message (or
  // was created most recently, if neither has messages yet) and offers the
  // rest for deletion — see deleteConversation in actions/messages.ts and
  // the find-before-create fix in respondToConnection that stops new ones
  // from forming going forward.
  const dmConversations = await prisma.conversation.findMany({
    where: { isGroup: false },
    orderBy: { createdAt: "asc" },
    take: 1000,
    select: {
      id: true,
      createdAt: true,
      members: { select: { userId: true, user: { select: { name: true } } } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });
  const conversationGroupsByKey = new Map<string, typeof dmConversations>();
  for (const conv of dmConversations) {
    if (conv.members.length !== 2) continue;
    const key = conv.members
      .map((m) => m.userId)
      .sort()
      .join(":");
    const group = conversationGroupsByKey.get(key) ?? [];
    group.push(conv);
    conversationGroupsByKey.set(key, group);
  }
  const duplicateConversationGroups = [...conversationGroupsByKey.values()]
    .filter((g) => g.length > 1)
    .map((g) => {
      const sorted = [...g].sort((a, b) => {
        const aLast = (a.messages[0]?.createdAt ?? a.createdAt).getTime();
        const bLast = (b.messages[0]?.createdAt ?? b.createdAt).getTime();
        return bLast - aLast;
      });
      return { keeper: sorted[0], duplicates: sorted.slice(1) };
    });
  const duplicateCount =
    duplicatePostGroups.reduce((sum, g) => sum + g.length - 1, 0) +
    duplicateConversationGroups.reduce((sum, g) => sum + g.duplicates.length, 0);

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
        Login issues ({lockedUsers.length + failedAttemptUsers.length + unverifiedStuckUsers.length})
      </h2>
      <p className="mt-1 text-xs text-foreground-soft">
        Accounts having trouble getting in — surfaced here so support doesn&apos;t
        depend on the member knowing to reach out. Use{" "}
        <Link href="/admin/users" className="text-accent hover:underline">
          Users
        </Link>{" "}
        to look someone up directly instead.
      </p>

      <div className="mt-3 space-y-3">
        <div>
          <p className="text-xs font-medium">
            Locked out ({lockedUsers.length})
          </p>
          <p className="text-xs text-foreground-soft">
            4 wrong passwords locks an account for 24h. Sending a password
            reset unlocks it immediately — they don&apos;t have to wait.
          </p>
          <div className="mt-2 space-y-2">
            {lockedUsers.map((u) => (
              <div
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{u.name ?? u.username ?? u.email}</p>
                  <p className="text-xs text-danger">
                    {u.email} · locked until {u.lockedUntil!.toLocaleString()}
                  </p>
                </div>
                <AdminSendResetButton userId={u.id} />
              </div>
            ))}
            {lockedUsers.length === 0 && (
              <p className="text-xs text-foreground-soft">No locked accounts right now.</p>
            )}
          </div>
        </div>

        <div>
          <p className="mt-4 text-xs font-medium">
            Recent failed attempts, not yet locked ({failedAttemptUsers.length})
          </p>
          <p className="text-xs text-foreground-soft">
            Heading toward a lockout at 4 attempts. If this is the real
            owner struggling with their password, send a reset before that
            happens.
          </p>
          <div className="mt-2 space-y-2">
            {failedAttemptUsers.map((u) => (
              <div
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{u.name ?? u.username ?? u.email}</p>
                  <p className="text-xs text-foreground-soft">
                    {u.email} · {u.failedLoginAttempts} failed attempt(s)
                  </p>
                </div>
                <AdminSendResetButton userId={u.id} />
              </div>
            ))}
            {failedAttemptUsers.length === 0 && (
              <p className="text-xs text-foreground-soft">Nothing here right now.</p>
            )}
          </div>
        </div>

        <div>
          <p className="mt-4 text-xs font-medium">
            Stuck unverified ({unverifiedStuckUsers.length})
          </p>
          <p className="text-xs text-foreground-soft">
            Signed up but never confirmed their email — sign-in is blocked
            entirely until they do. Resend the confirmation email if theirs
            was lost or filtered as spam.
          </p>
          <div className="mt-2 space-y-2">
            {unverifiedStuckUsers.map((u) => (
              <div
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{u.name ?? u.username ?? u.email}</p>
                  <p className="text-xs text-foreground-soft">
                    {u.email} · signed up {u.createdAt.toLocaleString()}
                  </p>
                </div>
                <AdminResendVerificationButton userId={u.id} />
              </div>
            ))}
            {unverifiedStuckUsers.length === 0 && (
              <p className="text-xs text-foreground-soft">Nothing here right now.</p>
            )}
          </div>
        </div>

        <div>
          <p className="mt-4 text-xs font-medium">
            Resolved in the last 24h ({recentlyResolvedLoginIssueUsers.length})
          </p>
          <p className="text-xs text-foreground-soft">
            Cleared automatically once the person got back in or confirmed
            their email — kept here briefly in case it comes up again, then
            drops off the queue on its own.
          </p>
          <div className="mt-2 space-y-2">
            {recentlyResolvedLoginIssueUsers.map((u) => (
              <div
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3 opacity-70"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{u.name ?? u.username ?? u.email}</p>
                  <p className="text-xs text-success">
                    {u.email} · resolved {u.loginIssueResolvedAt!.toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
            {recentlyResolvedLoginIssueUsers.length === 0 && (
              <p className="text-xs text-foreground-soft">Nothing here right now.</p>
            )}
          </div>
        </div>
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
        Duplicates ({duplicateCount})
      </h2>
      <p className="mt-1 text-xs text-foreground-soft">
        Same author + identical post text, or two DM threads between the same
        two people, from the last 7 days. The earliest post / most recently
        active thread in each group is kept automatically — everything else
        is offered for deletion.
      </p>
      <div className="mt-3 space-y-3">
        {duplicatePostGroups.map((group) => (
          <div key={group[0].id} className="rounded-lg border border-line p-3">
            <p className="text-xs text-foreground-soft">
              {group.length} copies by {group[0].author.name ?? "Unknown"}
            </p>
            <p className="mt-1 text-sm">{group[0].content}</p>
            <div className="mt-2 space-y-1">
              {group.slice(1).map((post) => (
                <div key={post.id} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-foreground-soft">
                    Posted {post.createdAt.toLocaleString()}
                  </span>
                  <AdminDeletePostButton postId={post.id} />
                </div>
              ))}
            </div>
          </div>
        ))}
        {duplicateConversationGroups.map(({ keeper, duplicates }) => (
          <div key={keeper.id} className="rounded-lg border border-line p-3">
            <p className="text-xs text-foreground-soft">
              {duplicates.length + 1} DM threads between{" "}
              {keeper.members.map((m) => m.user.name ?? "Unknown").join(" & ")}
            </p>
            <div className="mt-2 space-y-1">
              {duplicates.map((conv) => (
                <div key={conv.id} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-foreground-soft">
                    Started {conv.createdAt.toLocaleString()}
                  </span>
                  <AdminDeleteConversationButton conversationId={conv.id} />
                </div>
              ))}
            </div>
          </div>
        ))}
        {duplicateCount === 0 && (
          <p className="text-sm text-foreground-soft">No duplicates found.</p>
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
