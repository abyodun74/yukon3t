import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { CIRCLE_CATEGORIES } from "@/lib/circle-categories";
import { NewCircleWizard } from "@/components/new-circle-wizard";

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

      <NewCircleWizard categories={CIRCLE_CATEGORIES} />
    </div>
  );
}
