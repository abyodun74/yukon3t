import Link from "next/link";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { ReportTrigger } from "@/components/report-form";
import { TrustBadge } from "@/components/trust-badge";

const typeLabels: Record<string, string> = {
  SKILL_EXCHANGE: "Skill Exchange",
  VOLUNTEER: "Volunteer",
  STUDY_GROUP: "Study Group",
  PROJECT: "Project",
};

export default async function CollabPage() {
  await getOnboardedUserOrRedirect();

  const posts = await prisma.collabBoardPost.findMany({
    where: { status: "OPEN" },
    orderBy: { createdAt: "desc" },
    take: 40,
    include: { author: { select: { id: true, name: true, trustBand: true } } },
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Collab Boards</h1>
          <p className="mt-1 text-sm text-foreground-soft">
            Cross-country skill exchanges, volunteering, study groups, and
            projects.
          </p>
        </div>
        <Link
          href="/collab/new"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink"
        >
          Post a collaboration
        </Link>
      </div>

      <div className="mt-8 space-y-4">
        {posts.map((post) => (
          <div key={post.id} className="rounded-xl border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-xs font-medium text-teal">
                {typeLabels[post.type]}
              </span>
              <span className="text-right text-xs text-foreground-soft">
                {post.countries.join(", ")}
              </span>
            </div>
            <h2 className="mt-2 font-semibold">{post.title}</h2>
            <p className="mt-1 text-sm text-foreground-soft">{post.description}</p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Link
                  href={`/u/${post.author.id}`}
                  className="text-xs font-medium hover:text-accent"
                >
                  by {post.author.name}
                </Link>
                <TrustBadge band={post.author.trustBand} />
              </div>
              <ReportTrigger
                targetType="COLLAB_POST"
                targetId={post.id}
                reportedUserId={post.author.id}
              />
            </div>
          </div>
        ))}
        {posts.length === 0 && (
          <p className="text-sm text-foreground-soft">
            Nothing posted yet — start the first collaboration.
          </p>
        )}
      </div>
    </div>
  );
}
