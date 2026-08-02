import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { createCircle } from "@/app/actions/circles";
import { CIRCLE_CATEGORIES } from "@/lib/circle-categories";

export default async function NewCirclePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await getOnboardedUserOrRedirect();
  const { error } = await searchParams;

  return (
    <div className="mx-auto max-w-lg px-4 py-14">
      <h1 className="text-2xl font-semibold">Start a Circle</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        Free forever. You become the owner and first moderator.
      </p>

      {error && (
        <p className="mt-4 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          {error === "rate_limited"
            ? "You're creating Circles too fast — try again in an hour."
            : error === "moderation"
              ? "That name/description didn't pass our content guidelines."
              : "Please check your inputs."}
        </p>
      )}

      <form action={createCircle} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium">Name</label>
          <input
            name="name"
            required
            minLength={3}
            maxLength={60}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Category</label>
          <select
            name="category"
            required
            defaultValue=""
            className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          >
            <option value="" disabled>
              Select a category...
            </option>
            {CIRCLE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">Theme</label>
          <p className="mt-0.5 text-xs text-foreground-soft">
            Describe what this Circle is about — the shared interest or
            identity that brings people here — so members know what to
            expect before they join.
          </p>
          <textarea
            name="description"
            required
            minLength={10}
            maxLength={1000}
            rows={4}
            placeholder="e.g. A space for first-gen university students abroad to swap advice on visas, housing, and homesickness."
            className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
        >
          Create Circle
        </button>
      </form>
    </div>
  );
}
