import { notFound, redirect } from "next/navigation";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { updateCollabPost } from "@/app/actions/collab";
import { isCollabAdmin, getCollabMembership } from "@/lib/collab-permissions";
import { BackButton } from "@/components/back-button";
import { CollabCountriesField } from "@/components/collab-countries-field";
import { CollabSubmitButton } from "@/components/collab-submit-button";
import { MultiSelect } from "@/components/multi-select";
import { COLLAB_TYPES } from "@/lib/collab-types";

export default async function EditCollabPostPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { id } = await params;
  const { error } = await searchParams;

  const collab = await prisma.collabBoardPost.findUnique({ where: { id } });
  if (!collab) notFound();

  const membership = await getCollabMembership(id, me.id);
  if (!isCollabAdmin(collab, membership, me)) {
    redirect(`/collab/${id}`);
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-14">
      <BackButton fallbackHref={`/collab/${id}`} />
      <h1 className="mt-1 text-2xl font-semibold">Edit collaboration</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        Changes apply immediately, even if people have already joined or a session has started.
      </p>

      {error && (
        <p className="mt-4 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          {error === "rate_limited"
            ? "You're editing too fast — try again shortly."
            : error === "moderation"
              ? "That didn't pass our content guidelines."
              : "Please check your inputs."}
        </p>
      )}

      <form action={updateCollabPost.bind(null, id)} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium">Title</label>
          <input
            name="title"
            required
            minLength={5}
            maxLength={100}
            defaultValue={collab.title}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Type</label>
          <div className="mt-1">
            <MultiSelect
              name="type"
              options={COLLAB_TYPES}
              defaultValues={[collab.type]}
              placeholder="Search collaboration types..."
              max={1}
            />
          </div>
        </div>
        <CollabCountriesField defaultWorldwide={collab.worldwide} defaultCountries={collab.countries} />
        <div>
          <label className="block text-sm font-medium">What is this collaboration?</label>
          <textarea
            name="description"
            required
            minLength={20}
            maxLength={2000}
            rows={5}
            defaultValue={collab.description}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <CollabSubmitButton label="Save changes" pendingLabel="Saving..." />
      </form>
    </div>
  );
}
