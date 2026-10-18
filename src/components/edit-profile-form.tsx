"use client";

import { useState } from "react";
import { Pencil, X } from "lucide-react";
import { updateProfile } from "@/app/actions/profile";
import { AvatarUpload } from "@/components/avatar-upload";
import { MultiSelect } from "@/components/multi-select";
import { useFeedText } from "@/components/feed-text";
import { useProfileText } from "@/components/profile-text";
import { intentTagValues } from "@/lib/validations";
import type { sharedEn } from "@/lib/i18n/en/shared";

type Option = { value: string; label: string };

/**
 * The three option lists arrive from the profile page already in the reader's language (`label`); `value` is the
 * stored English name, which is what the form submits.
 */
export function EditProfileForm({
  user,
  countryOptions,
  languageOptions,
  interestOptions,
  multiSelectLabels,
  privateAvatarUpload = false,
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
  countryOptions: Option[];
  languageOptions: Option[];
  interestOptions: Option[];
  multiSelectLabels: typeof sharedEn.multiSelect;
  /** AVATAR_PRIVATE is on: new profile pictures go to the private bucket (see AvatarUpload). */
  privateAvatarUpload?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useProfileText();
  const intents = useFeedText().t.intents;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-full border border-line px-4 py-1.5 text-sm font-medium hover:border-accent hover:text-accent"
      >
        <Pencil size={14} />
        {t.edit.open}
      </button>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t.edit.open}</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t.edit.cancel}
          className="rounded-lg p-1 text-foreground-soft hover:bg-line"
        >
          <X size={16} />
        </button>
      </div>

      <div className="mt-4">
        <label className="block text-sm font-medium">{t.edit.picture}</label>
        <div className="mt-2">
          <AvatarUpload currentUrl={user.avatarUrl} privateUpload={privateAvatarUpload} />
        </div>
      </div>

      <form action={updateProfile} className="mt-4 space-y-4">
        <div>
          <label className="block text-sm font-medium">{t.edit.name}</label>
          <input
            aria-label={t.edit.name}
            name="name"
            required
            minLength={2}
            maxLength={60}
            defaultValue={user.name ?? ""}
            dir="auto"
            className="mt-1 w-full rounded-lg border border-line bg-background px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">{t.edit.bio}</label>
          <textarea
            aria-label={t.edit.bio}
            name="bio"
            maxLength={500}
            rows={3}
            defaultValue={user.bio ?? ""}
            dir="auto"
            className="mt-1 w-full rounded-lg border border-line bg-background px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">{t.edit.country}</label>
          <select
            aria-label={t.edit.country}
            name="country"
            required
            defaultValue={user.country ?? ""}
            className="mt-1 w-full rounded-lg border border-line bg-background px-4 py-2.5 text-sm outline-none focus:border-accent"
          >
            <option value="" disabled>
              {t.edit.countryPlaceholder}
            </option>
            {countryOptions.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium">{t.edit.languages}</label>
          <div className="mt-1">
            <MultiSelect
              name="languages"
              options={languageOptions}
              defaultValues={user.languages}
              placeholder={t.edit.languagesPlaceholder}
              max={10}
              labels={multiSelectLabels}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium">{t.edit.interests}</label>
          <div className="mt-1">
            <MultiSelect
              name="interests"
              options={interestOptions}
              defaultValues={user.interests}
              placeholder={t.edit.interestsPlaceholder}
              max={15}
              labels={multiSelectLabels}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium">{t.edit.openTo}</label>
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
                {intents[tag]}
              </label>
            ))}
          </div>
        </div>
        <button
          type="submit"
          className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
        >
          {t.edit.save}
        </button>
      </form>
    </div>
  );
}
