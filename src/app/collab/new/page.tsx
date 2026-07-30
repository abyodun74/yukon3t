import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { createCollabPost } from "@/app/actions/collab";
import { COUNTRIES } from "@/lib/countries";
import { MultiSelect } from "@/components/multi-select";

export default async function NewCollabPostPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await getOnboardedUserOrRedirect();
  const { error } = await searchParams;

  return (
    <div className="mx-auto max-w-lg px-4 py-14">
      <h1 className="text-2xl font-semibold">Post a collaboration</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        Skill exchange, volunteering, study groups, or projects that cross
        borders.
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
          <select
            name="type"
            required
            className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          >
            <option value="SKILL_EXCHANGE">Skill Exchange</option>
            <option value="VOLUNTEER">Volunteer</option>
            <option value="STUDY_GROUP">Study Group</option>
            <option value="PROJECT">Project</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">Countries involved</label>
          <div className="mt-1">
            <MultiSelect
              name="countries"
              options={COUNTRIES}
              placeholder="Search countries..."
              max={10}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium">Description</label>
          <textarea
            name="description"
            required
            minLength={20}
            maxLength={2000}
            rows={5}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
        >
          Post
        </button>
      </form>
    </div>
  );
}
