"use client";

import { useState } from "react";
import { Pencil, X } from "lucide-react";
import { updateProfile } from "@/app/actions/profile";
import { AvatarUpload } from "@/components/avatar-upload";
import { MultiSelect } from "@/components/multi-select";
import { intentTagValues, intentLabels } from "@/lib/validations";
import { COUNTRIES } from "@/lib/countries";
import { LANGUAGES } from "@/lib/languages";
import { INTERESTS } from "@/lib/interests";

export function EditProfileForm({
  user,
}: {
  user: {
    avatarUrl: string | null;
    name: string | null;
    bio: string | null;
    country: string | null;
    languages: string[];
    interests: string[];
    openToIntents: (typeof intentTagValues)[number][];
  };
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-full border border-line px-4 py-1.5 text-sm font-medium hover:border-accent hover:text-accent"
      >
        <Pencil size={14} />
        Edit profile
      </button>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Edit profile</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Cancel editing"
          className="rounded-lg p-1 text-foreground-soft hover:bg-line"
        >
          <X size={16} />
        </button>
      </div>

      <div className="mt-4">
        <label className="block text-sm font-medium">Profile picture</label>
        <div className="mt-2">
          <AvatarUpload currentUrl={user.avatarUrl} />
        </div>
      </div>

      <form action={updateProfile} className="mt-4 space-y-4">
        <div>
          <label className="block text-sm font-medium">Display name</label>
          <input
            name="name"
            required
            minLength={2}
            maxLength={60}
            defaultValue={user.name ?? ""}
            className="mt-1 w-full rounded-lg border border-line bg-background px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Bio</label>
          <textarea
            name="bio"
            maxLength={500}
            rows={3}
            defaultValue={user.bio ?? ""}
            className="mt-1 w-full rounded-lg border border-line bg-background px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">Country</label>
          <select
            name="country"
            required
            defaultValue={user.country ?? ""}
            className="mt-1 w-full rounded-lg border border-line bg-background px-4 py-2.5 text-sm outline-none focus:border-accent"
          >
            <option value="" disabled>
              Select your country...
            </option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">Languages</label>
          <div className="mt-1">
            <MultiSelect
              name="languages"
              options={LANGUAGES}
              defaultValues={user.languages}
              placeholder="Search languages..."
              max={10}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium">Interests</label>
          <div className="mt-1">
            <MultiSelect
              name="interests"
              options={INTERESTS}
              defaultValues={user.interests}
              placeholder="Search interests..."
              max={15}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium">Open to</label>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
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
    </div>
  );
}
