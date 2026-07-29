import { redirect } from "next/navigation";
import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { ModerationActionForm } from "@/components/moderation-action-form";

export default async function ModerationQueuePage() {
  const user = await getSessionUserOrRedirect();
  if (!user.isAdmin) redirect("/discover");

  const [open, resolved] = await Promise.all([
    prisma.report.findMany({
      where: { status: { in: ["OPEN", "REVIEWING"] } },
      orderBy: { createdAt: "asc" },
      include: {
        reporter: { select: { name: true } },
        reportedUser: { select: { id: true, name: true, status: true } },
      },
    }),
    prisma.report.findMany({
      where: { status: "RESOLVED" },
      orderBy: { resolvedAt: "desc" },
      take: 15,
      include: {
        reporter: { select: { name: true } },
        reportedUser: { select: { name: true } },
      },
    }),
  ]);

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
            <ModerationActionForm reportId={report.id} />
          </div>
        ))}
        {open.length === 0 && (
          <p className="text-sm text-foreground-soft">Queue is clear.</p>
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
