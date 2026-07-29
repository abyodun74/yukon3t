import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { updateProfile } from "@/app/actions/profile";
import { intentTagValues } from "@/lib/validations";
import { AccountDangerZone } from "@/components/account-danger-zone";
import { AvatarUpload } from "@/components/avatar-upload";

const intentLabels: Record<string, string> = {
  FRIENDSHIP: "Friendship",
  CULTURAL_EXCHANGE: "Cultural Exchange",
  PROFESSIONAL: "Professional",
  COMMUNITY: "Community",
  DATING: "Dating",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const user = await getSessionUserOrRedirect();
  const { error, saved } = await searchParams;

  return (
    <div className="mx-auto max-w-xl space-y-10 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-foreground-soft">
          Signed in as {user.email}
        </p>
      </div>

      {saved && (
        <p className="rounded-lg bg-success/10 px-4 py-2 text-sm text-success">
          Profile updated.
        </p>
      )}
      {error && (
        <p className="rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          {error === "moderation"
            ? "Your bio didn't pass our content guidelines."
            : "Please check your inputs."}
        </p>
      )}

      <div>
        <label className="block text-sm font-medium">Profile picture</label>
        <div className="mt-2">
          <AvatarUpload currentUrl={user.avatarUrl} />
        </div>
      </div>

      <form action={updateProfile} className="space-y-4">
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
            defaultValue={user.interests.join(", ")}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Open to</label>
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
          Save changes
        </button>
      </form>

      <AccountDangerZone />
    </div>
  );
}
