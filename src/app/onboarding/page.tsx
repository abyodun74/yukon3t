import { getSessionUserOrRedirect, isProfileComplete } from "@/lib/page-guards";
import { completeOnboarding } from "@/app/actions/profile";
import { redirect } from "next/navigation";
import { intentTagValues } from "@/lib/validations";

const intentLabels: Record<string, string> = {
  FRIENDSHIP: "Friendship",
  CULTURAL_EXCHANGE: "Cultural Exchange",
  PROFESSIONAL: "Professional",
  COMMUNITY: "Community",
  DATING: "Dating",
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getSessionUserOrRedirect();
  if (isProfileComplete(user)) {
    redirect("/discover");
  }
  const { error } = await searchParams;

  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-semibold">Set up your profile</h1>
      <p className="mt-2 text-sm text-foreground-soft">
        This is what other members see. Be honest about your intent — it
        keeps this community usable for everyone.
      </p>

      {error === "invalid" && (
        <p className="mt-4 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          Please fill in all required fields.
        </p>
      )}
      {error === "moderation" && (
        <p className="mt-4 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          Your bio didn&apos;t pass our content guidelines. Please revise it.
        </p>
      )}

      <form action={completeOnboarding} className="mt-6 space-y-5">
        <div>
          <label className="block text-sm font-medium">Display name</label>
          <input
            name="name"
            required
            minLength={2}
            maxLength={60}
            defaultValue={user.name ?? ""}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Bio</label>
          <textarea
            name="bio"
            maxLength={500}
            rows={3}
            defaultValue={user.bio ?? ""}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Country</label>
          <input
            name="country"
            required
            minLength={2}
            defaultValue={user.country ?? ""}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium">
            Languages (comma-separated)
          </label>
          <input
            name="languages"
            placeholder="English, Spanish"
            defaultValue={user.languages.join(", ")}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium">
            Interests (comma-separated)
          </label>
          <input
            name="interests"
            required
            placeholder="Hiking, Photography, Startups"
            defaultValue={user.interests.join(", ")}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium">
            What are you open to here?
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {intentTagValues.map((tag) => (
              <label
                key={tag}
                className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  name="openToIntents"
                  value={tag}
                  defaultChecked={user.openToIntents.includes(tag)}
                />
                {intentLabels[tag]}
              </label>
            ))}
          </div>
        </div>

        <button
          type="submit"
          className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
        >
          Continue
        </button>
      </form>
    </div>
  );
}
