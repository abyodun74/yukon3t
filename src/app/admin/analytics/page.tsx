import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import type { AnalyticsEventType } from "@/lib/analytics";

const EVENT_LABELS: Record<AnalyticsEventType, string> = {
  SIGN_UP: "Sign-ups",
  SIGN_IN: "Sign-ins",
  POST_CREATED: "Posts created",
  CONNECTION_REQUESTED: "Connection requests sent",
  CONNECTION_ACCEPTED: "Connections accepted",
  MESSAGE_SENT: "Messages sent",
  CALL_STARTED: "Calls started",
  CIRCLE_JOINED: "Circles joined",
  CIRCLE_CREATED: "Circles created",
};

async function countsSince(daysAgo: number) {
  const since = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const rows = await prisma.analyticsEvent.groupBy({
    by: ["type"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.type, r._count._all]));
}

export default async function AdminAnalyticsPage() {
  const user = await getSessionUserOrRedirect();
  if (!user.isAdmin) redirect("/discover");

  const [last24h, last7d, last30d, totalUsers, verifiedUsers] = await Promise.all([
    countsSince(1),
    countsSince(7),
    countsSince(30),
    prisma.user.count(),
    prisma.user.count({ where: { emailVerified: { not: null } } }),
  ]);

  const eventTypes = Object.keys(EVENT_LABELS) as AnalyticsEventType[];

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/admin/moderation" className="text-xs text-foreground-soft hover:text-accent">
        &larr; Moderation queue
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Analytics</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        First-party usage counts — {totalUsers} total accounts, {verifiedUsers} email-verified.
        Tracking started when this dashboard shipped, so history before that isn&apos;t included.
      </p>

      <div className="mt-8 overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-foreground-soft">
              <th className="px-4 py-3 font-medium">Event</th>
              <th className="px-4 py-3 font-medium">Last 24h</th>
              <th className="px-4 py-3 font-medium">Last 7d</th>
              <th className="px-4 py-3 font-medium">Last 30d</th>
            </tr>
          </thead>
          <tbody>
            {eventTypes.map((type) => (
              <tr key={type} className="border-b border-line last:border-0">
                <td className="px-4 py-3">{EVENT_LABELS[type]}</td>
                <td className="px-4 py-3 tabular-nums">{last24h.get(type) ?? 0}</td>
                <td className="px-4 py-3 tabular-nums">{last7d.get(type) ?? 0}</td>
                <td className="px-4 py-3 tabular-nums">{last30d.get(type) ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
