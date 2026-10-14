import { Suspense } from "react";
import { UNVERIFIED_ACCOUNT_WHERE } from "@/lib/account-verification";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { captureError } from "@/lib/error-tracking";
import { createConcurrencyLimit, type ConcurrencyLimit } from "@/lib/concurrency-limit";
import { loadModerationDuplicates } from "@/lib/moderation-duplicates-data";
import { Skeleton } from "@/components/skeleton";
import { ModerationActionForm } from "@/components/moderation-action-form";
import { FlaggedContentActions } from "@/components/flagged-content-actions";
import { AdminSendResetButton } from "@/components/admin-send-reset-button";
import { AdminResendVerificationButton } from "@/components/admin-resend-verification-button";
import { AdminDeletePostButton } from "@/components/admin-delete-post-button";
import { AdminDeleteConversationButton } from "@/components/admin-delete-conversation-button";
import { STUCK_UNVERIFIED_AFTER_MS, RESOLVED_LOGIN_ISSUE_VISIBLE_MS } from "@/lib/login-issues";

// How many of this page's queries may be in flight at once, across all of
// its sections. One below the Prisma pool's default of 5 connections per
// instance (src/lib/prisma.ts), so the page never queues behind itself for a
// connection — a wait there fails after 5s.
const MAX_CONCURRENT_QUERIES = 4;

const SECTION_HEADING = "mt-10 text-sm font-semibold uppercase tracking-wide text-foreground-soft";

type SectionProps = { limit: ConcurrencyLimit };

/**
 * A section's queries, with a failure contained to that section: it renders
 * SectionUnavailable instead of taking the whole page (and every other
 * queue on it) down with it.
 */
async function loadSection<T>(section: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (err) {
    console.error(`[admin/moderation] failed to load ${section}`, err);
    await captureError(err, { route: "admin/moderation", section });
    return null;
  }
}

function SectionUnavailable() {
  return (
    <p role="alert" className="mt-3 text-sm text-danger">
      Couldn&apos;t load this section. Reload the page to try again.
    </p>
  );
}

function SectionFallback({ title }: { title?: string }) {
  return (
    <>
      {title && <h2 className={SECTION_HEADING}>{title}</h2>}
      <div className={title ? "mt-3 space-y-3" : "mt-8 space-y-4"}>
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
    </>
  );
}

/**
 * What Moderation in the Admin profile can do:
 *  - Reports queue: a member reported a user, post, comment, message, Circle,
 *    or collab post. An admin resolves it by dismissing, warning/suspending/
 *    banning the reported user, or removing the reported content outright
 *    (post/comment/message removed, Circle deleted, collab post closed).
 *    A report left OPEN/REVIEWING for 72h with no admin action is
 *    auto-dismissed by the resolve-stale-reports cron (see
 *    src/lib/report-queue.ts) — no enforcement action, just queue hygiene.
 *  - Flagged content queue: content our automated moderation (see
 *    src/lib/moderation.ts) held back at creation time, before anyone
 *    reported it. An admin reviews it and either publishes it or removes it.
 *  - Login issues: accounts locked out, racking up failed passwords, or
 *    stuck unverified — surfaced proactively (not just reachable by
 *    searching /admin/users) so support doesn't depend on the member
 *    knowing to ask.
 * Each queue below is its own async component behind its own Suspense
 * boundary, so they stream in independently and a slow one holds up only
 * itself; all of them draw on one shared query limit (see
 * MAX_CONCURRENT_QUERIES).
 * Every action writes an AuditLog entry against the content's author/the
 * reported user, so it's always explainable and appealable.
 */
export default async function ModerationQueuePage() {
  const user = await getSessionUserOrRedirect();
  if (!user.isAdmin) redirect("/discover");

  const limit = createConcurrencyLimit(MAX_CONCURRENT_QUERIES);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Moderation queue</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        Every action here writes a reason to the affected user&apos;s audit
        trail. Target: 95% triaged within 24 hours.
      </p>

      <Suspense fallback={<SectionFallback />}>
        <ReportsQueueSection limit={limit} />
      </Suspense>
      <Suspense fallback={<SectionFallback title="Login issues" />}>
        <LoginIssuesSection limit={limit} />
      </Suspense>
      <Suspense fallback={<SectionFallback title="Flagged content" />}>
        <FlaggedContentSection limit={limit} />
      </Suspense>
      <Suspense fallback={<SectionFallback title="Hidden comments" />}>
        <HiddenCommentsSection limit={limit} />
      </Suspense>
      <Suspense fallback={<SectionFallback title="Duplicates" />}>
        <DuplicatesSection limit={limit} />
      </Suspense>
      <Suspense fallback={<SectionFallback title="Recently resolved" />}>
        <RecentlyResolvedSection limit={limit} />
      </Suspense>
    </div>
  );
}

async function ReportsQueueSection({ limit }: SectionProps) {
  const open = await loadSection("reports queue", () =>
    limit(() =>
      prisma.report.findMany({
        where: { status: { in: ["OPEN", "REVIEWING"] } },
        orderBy: { createdAt: "asc" },
        // Oldest-first plus a generous cap — this is the actionable backlog
        // admins are expected to fully work through, not a "recent" preview
        // like the queues below, so this exists as a blowup circuit-breaker
        // (e.g. a spam wave), not a normal-operation pagination limit.
        take: 200,
        select: {
          id: true,
          targetType: true,
          createdAt: true,
          reason: true,
          evidenceText: true,
          reporter: { select: { name: true } },
          reportedUser: { select: { name: true, status: true } },
        },
      }),
    ),
  );
  if (!open) {
    return (
      <div className="mt-8">
        <SectionUnavailable />
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-4">
      {open.map((report) => (
        <div key={report.id} className="rounded-xl border border-line p-4">
          <div className="flex items-center justify-between text-xs text-foreground-soft">
            <span>
              {report.targetType} · reported by {report.reporter.name}
            </span>
            <span>{report.createdAt.toLocaleString()}</span>
          </div>
          <p className="mt-2 break-words text-sm">{report.reason}</p>
          {report.evidenceText && (
            <div className="mt-2 rounded-lg border border-line bg-surface p-2 text-xs">
              <p className="font-medium text-foreground-soft">
                Message text supplied by the reporter — from a secret (end-to-end encrypted) chat, so we can&apos;t
                read it or verify it:
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words">{report.evidenceText}</p>
            </div>
          )}
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
  );
}

async function LoginIssuesSection({ limit }: SectionProps) {
  const now = new Date();
  const data = await loadSection("login issues", () =>
    Promise.all([
      // Non-ACTIVE/DEACTIVATED accounts (banned, suspended) are deliberately
      // excluded from all three login-issue queries below — that's an
      // intentional moderation block handled via the reports queue above, not
      // an access problem to fix here.
      limit(() =>
        prisma.user.findMany({
          where: { status: { in: ["ACTIVE", "DEACTIVATED"] }, lockedUntil: { gt: now } },
          orderBy: { lockedUntil: "desc" },
          take: 30,
          select: { id: true, name: true, username: true, email: true, lockedUntil: true },
        }),
      ),
      limit(() =>
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
      ),
      limit(() =>
        prisma.user.findMany({
          where: {
            status: "ACTIVE",
            // Verified neither by email nor by phone (src/lib/account-verification.ts): an account that
            // verified by text is signed in and using the app, not stuck.
            ...UNVERIFIED_ACCOUNT_WHERE,
            createdAt: { lt: new Date(now.getTime() - STUCK_UNVERIFIED_AFTER_MS) },
            // Excludes accounts the resolve-login-issues cron already auto-dismissed
            // after 48h unresolved (src/app/api/cron/resolve-login-issues) — without
            // this, still-unverified-but-dismissed accounts would keep showing here
            // forever, since verifying is what would otherwise naturally clear this
            // bucket (the verification columns stay null either way).
            loginIssueResolvedAt: null,
          },
          orderBy: { createdAt: "asc" },
          take: 30,
          select: { id: true, name: true, username: true, email: true, createdAt: true },
        }),
      ),
      limit(() =>
        prisma.user.findMany({
          where: {
            loginIssueResolvedAt: { gt: new Date(now.getTime() - RESOLVED_LOGIN_ISSUE_VISIBLE_MS) },
          },
          orderBy: { loginIssueResolvedAt: "desc" },
          take: 30,
          select: { id: true, name: true, username: true, email: true, loginIssueResolvedAt: true },
        }),
      ),
    ]),
  );
  if (!data) {
    return (
      <>
        <h2 className={SECTION_HEADING}>Login issues</h2>
        <SectionUnavailable />
      </>
    );
  }
  const [lockedUsers, failedAttemptUsers, unverifiedStuckUsers, resolvedLoginIssueUsers] = data;

  // A user can rack up a fresh issue after a past one resolved (e.g.
  // resolved a lockout, then got locked out again) — the active queries
  // above are the source of truth for "currently a problem", so drop
  // anyone from "recently resolved" who's still showing up there too.
  const activeIds = new Set([...lockedUsers, ...failedAttemptUsers, ...unverifiedStuckUsers].map((u) => u.id));
  const recentlyResolvedLoginIssueUsers = resolvedLoginIssueUsers.filter((u) => !activeIds.has(u.id));

  return (
    <>
      <h2 className={SECTION_HEADING}>
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
    </>
  );
}

async function FlaggedContentSection({ limit }: SectionProps) {
  const data = await loadSection("flagged content", () =>
    Promise.all([
      limit(() =>
        prisma.post.findMany({
          where: { moderationStatus: "FLAGGED" },
          orderBy: { createdAt: "asc" },
          take: 20,
          select: { id: true, content: true, author: { select: { name: true } } },
        }),
      ),
      limit(() =>
        prisma.comment.findMany({
          where: { moderationStatus: "FLAGGED" },
          orderBy: { createdAt: "asc" },
          take: 20,
          select: { id: true, content: true, author: { select: { name: true } } },
        }),
      ),
      limit(() =>
        prisma.message.findMany({
          where: { moderationStatus: "FLAGGED" },
          orderBy: { createdAt: "asc" },
          take: 20,
          select: { id: true, content: true, sender: { select: { name: true } } },
        }),
      ),
      // A Muse over HIVE_VIDEO_MODERATION_MAX_SECONDS (60s) publishes FLAGGED
      // pending the moderate-long-videos cron's Cloudflare Stream + OpenAI
      // pipeline (see createMuse, actions/muse.ts) — that cron runs every
      // minute and normally clears this within a few, so most rows here are
      // just in-flight, not stuck. Still worth a real queue (this used to have
      // none at all, unlike Post/Comment/Message above): a review whose
      // automated verdict never lands — a crashed tick, a Cloudflare/OpenAI
      // outage — had no way for an admin to see or rescue it, and its author
      // had no way to see it either; "Posted!" would show client-side, then
      // the Muse would just never appear, with nothing telling anyone why.
      limit(() =>
        prisma.muse.findMany({
          where: { moderationStatus: "FLAGGED" },
          orderBy: { createdAt: "asc" },
          take: 20,
          select: {
            id: true,
            caption: true,
            videoDurationSeconds: true,
            createdAt: true,
            videoLongReviewClaimedAt: true,
            author: { select: { name: true } },
          },
        }),
      ),
    ]),
  );
  if (!data) {
    return (
      <>
        <h2 className={SECTION_HEADING}>Flagged content</h2>
        <SectionUnavailable />
      </>
    );
  }
  const [flaggedPosts, flaggedComments, flaggedMessages, flaggedMuses] = data;
  const flaggedCount = flaggedPosts.length + flaggedComments.length + flaggedMessages.length + flaggedMuses.length;

  return (
    <>
      <h2 className={SECTION_HEADING}>
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
            <p className="mt-1 break-words text-sm">{post.content || "(media post, no caption)"}</p>
            <FlaggedContentActions contentType="POST" contentId={post.id} />
          </div>
        ))}
        {flaggedComments.map((comment) => (
          <div key={comment.id} className="rounded-lg border border-line p-3">
            <p className="text-xs text-foreground-soft">Comment by {comment.author.name}</p>
            <p className="mt-1 break-words text-sm">{comment.content}</p>
            <FlaggedContentActions contentType="COMMENT" contentId={comment.id} />
          </div>
        ))}
        {flaggedMessages.map((message) => (
          <div key={message.id} className="rounded-lg border border-line p-3">
            <p className="text-xs text-foreground-soft">Message from {message.sender.name}</p>
            <p className="mt-1 break-words text-sm">{message.content}</p>
            <FlaggedContentActions contentType="MESSAGE" contentId={message.id} />
          </div>
        ))}
        {flaggedMuses.map((muse) => (
          <div key={muse.id} className="rounded-lg border border-line p-3">
            <p className="text-xs text-foreground-soft">
              Muse by {muse.author.name} · {muse.videoDurationSeconds}s · posted {muse.createdAt.toLocaleString()}
            </p>
            <p className="mt-1 break-words text-sm">{muse.caption || "(no caption)"}</p>
            <p className="mt-1 text-xs text-foreground-soft">
              {muse.videoLongReviewClaimedAt
                ? "Automated review in progress — only publish/remove manually if this has sat here a while."
                : "Not currently being reviewed automatically — safe to resolve now."}
            </p>
            <FlaggedContentActions contentType="MUSE" contentId={muse.id} />
          </div>
        ))}
        {flaggedCount === 0 && (
          <p className="text-sm text-foreground-soft">Nothing flagged right now.</p>
        )}
      </div>
    </>
  );
}

async function HiddenCommentsSection({ limit }: SectionProps) {
  // Hidden by a post author/Circle co-admin, not an admin — see hideComment
  // in comments.ts. Unlike a report or a flagged-at-creation item, these
  // never otherwise surface anywhere an admin would see them.
  const hiddenComments = await loadSection("hidden comments", () =>
    limit(() =>
      prisma.comment.findMany({
        where: { moderationStatus: "REMOVED" },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { id: true, content: true, author: { select: { name: true } } },
      }),
    ),
  );
  if (!hiddenComments) {
    return (
      <>
        <h2 className={SECTION_HEADING}>Hidden comments</h2>
        <SectionUnavailable />
      </>
    );
  }

  return (
    <>
      <h2 className={SECTION_HEADING}>
        Hidden comments ({hiddenComments.length})
      </h2>
      <p className="mt-1 text-xs text-foreground-soft">
        Hidden by a post author or Circle co-admin, not reported or auto-flagged. Publish to restore or remove outright.
      </p>
      <div className="mt-3 space-y-3">
        {hiddenComments.map((comment) => (
          <div key={comment.id} className="rounded-lg border border-line p-3">
            <p className="text-xs text-foreground-soft">Comment by {comment.author.name}</p>
            <p className="mt-1 break-words text-sm">{comment.content}</p>
            <FlaggedContentActions contentType="COMMENT" contentId={comment.id} />
          </div>
        ))}
        {hiddenComments.length === 0 && (
          <p className="text-sm text-foreground-soft">No hidden comments right now.</p>
        )}
      </div>
    </>
  );
}

async function DuplicatesSection({ limit }: SectionProps) {
  const data = await loadSection("duplicates", () => loadModerationDuplicates(new Date(), limit));
  if (!data) {
    return (
      <>
        <h2 className={SECTION_HEADING}>Duplicates</h2>
        <SectionUnavailable />
      </>
    );
  }
  const { postGroups, dmGroups, groupGroups, duplicateCount } = data;

  return (
    <>
      <h2 className={SECTION_HEADING}>
        Duplicates ({duplicateCount})
      </h2>
      <p className="mt-1 text-xs text-foreground-soft">
        Same author + identical post text, two DM threads between the same
        two people, or two groups from the same creator with the same name —
        posts scoped to the last 7 days, threads/groups scanned regardless of
        age. The earliest post / most recently active thread or group in
        each set is kept automatically — everything else is offered for
        deletion.
      </p>
      <div className="mt-3 space-y-3">
        {postGroups.map((group) => (
          <div key={group[0].id} className="rounded-lg border border-line p-3">
            <p className="text-xs text-foreground-soft">
              {group.length} copies by {group[0].author.name ?? "Unknown"}
            </p>
            <p className="mt-1 break-words text-sm">{group[0].content}</p>
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
        {dmGroups.map(({ keeper, duplicates }) => (
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
        {groupGroups.map(({ keeper, duplicates }) => (
          <div key={keeper.id} className="rounded-lg border border-line p-3">
            <p className="text-xs text-foreground-soft">
              {duplicates.length + 1} groups named &ldquo;{keeper.name}&rdquo; created by{" "}
              {keeper.createdBy?.name ?? "Unknown"}
            </p>
            <div className="mt-2 space-y-1">
              {duplicates.map((conv) => (
                <div key={conv.id} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-foreground-soft">
                    Created {conv.createdAt.toLocaleString()} · {conv._count.members} members
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
    </>
  );
}

async function RecentlyResolvedSection({ limit }: SectionProps) {
  const resolved = await loadSection("recently resolved", () =>
    limit(() =>
      prisma.report.findMany({
        where: { status: { in: ["RESOLVED", "DISMISSED"] } },
        orderBy: { resolvedAt: "desc" },
        take: 15,
        select: {
          id: true,
          targetType: true,
          resolutionNote: true,
          reportedUser: { select: { name: true } },
        },
      }),
    ),
  );
  if (!resolved) {
    return (
      <>
        <h2 className={SECTION_HEADING}>Recently resolved</h2>
        <SectionUnavailable />
      </>
    );
  }

  return (
    <>
      <h2 className={SECTION_HEADING}>
        Recently resolved
      </h2>
      <div className="mt-3 space-y-2">
        {resolved.map((r) => (
          <div key={r.id} className="rounded-lg border border-line p-3 text-xs text-foreground-soft">
            {r.targetType} report against {r.reportedUser?.name ?? "n/a"} — {r.resolutionNote}
          </div>
        ))}
      </div>
    </>
  );
}
