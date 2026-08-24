import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { createCollabPost } from "@/app/actions/collab";
import { CollabCountriesField } from "@/components/collab-countries-field";
import { CollabSubmitButton } from "@/components/collab-submit-button";
import { CollabVisibilityField } from "@/components/collab-visibility-field";
import { MultiSelect } from "@/components/multi-select";
import { COLLAB_TYPES } from "@/lib/collab-types";

export default async function NewCollabPostPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { error } = await searchParams;

  // Candidates for a private collab's invite list — same "my accepted
  // connections" query messages/[id]/page.tsx uses for group-add candidates.
  const accepted = await prisma.connection.findMany({
    where: { status: "ACCEPTED", OR: [{ requesterId: me.id }, { targetId: me.id }] },
    include: {
      requester: { select: { id: true, name: true } },
      target: { select: { id: true, name: true } },
    },
  });
  const inviteeCandidates = accepted.map((c) => {
    const other = c.requesterId === me.id ? c.target : c.requester;
    return { value: other.id, label: other.name ?? "Unknown" };
  });

  return (
    <div className="mx-auto max-w-lg px-4 py-14">
      <h1 className="text-2xl font-semibold">Post a collaboration</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        Skill exchanges, mentorship, professional services, events, and
        projects that cross borders.
      </p>

      {error && (
        <p className="mt-4 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          {error === "rate_limited"
            ? "You're posting too fast — try again shortly."
            : error === "moderation"
              ? "That didn't pass our content guidelines."
              : "Please check your inputs."}
        </p>
      )}

      <form action={createCollabPost} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium">Title</label>
          <input
            name="title"
            required
            minLength={5}
            maxLength={100}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Type</label>
          <p className="mt-0.5 text-xs text-foreground-soft">
            Search e.g. &quot;Tax Advising&quot;, &quot;Mentorship&quot;, or &quot;Sales &amp; Marketing&quot;.
          </p>
          <div className="mt-1">
            <MultiSelect name="type" options={COLLAB_TYPES} placeholder="Search collaboration types..." max={1} />
          </div>
        </div>
        <CollabCountriesField />
        <CollabVisibilityField candidates={inviteeCandidates} />
        <div>
          <label className="block text-sm font-medium">What is this collaboration?</label>
          <p className="mt-0.5 text-xs text-foreground-soft">
            Describe the goal before people commit — what you&apos;re trying
            to build or exchange, what a collaborator would actually do, and
            any expectations up front.
          </p>
          <textarea
            name="description"
            required
            minLength={20}
            maxLength={2000}
            rows={5}
            placeholder="e.g. Looking for 2-3 people to practice conversational Japanese/English exchange twice a week over video for the next month."
            className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <CollabSubmitButton />
      </form>
    </div>
  );
}
