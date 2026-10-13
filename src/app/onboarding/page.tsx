import { getSessionUserOrRedirect, isProfileComplete } from "@/lib/page-guards";
import { completeOnboarding } from "@/app/actions/profile";
import { redirect } from "next/navigation";
import { intentTagValues, MIN_AGE } from "@/lib/validations";
import { COUNTRIES } from "@/lib/countries";
import { LANGUAGES } from "@/lib/languages";
import { INTERESTS } from "@/lib/interests";
import { MultiSelect } from "@/components/multi-select";
import { SubmitButton } from "@/components/submit-button";
import { BirthDateSelect } from "@/components/birth-date-select";
import { LanguagePicker } from "@/components/language-picker";
import { countryName } from "@/lib/i18n/country-names";
import { interestName, languageName } from "@/lib/i18n/language-names";
import { format } from "@/lib/i18n/locales";
import { getDictionary, getLocale } from "@/lib/i18n/server";

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
  const locale = await getLocale();
  const dictionary = await getDictionary();
  const t = dictionary.onboarding;

  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      <p className="mt-2 text-sm text-foreground-soft">{t.intro}</p>
      <p className="mt-2 text-sm font-medium text-foreground">{t.required}</p>

      {error === "invalid" && (
        <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          {t.errors.invalid}
        </p>
      )}
      {error === "moderation" && (
        <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          {t.errors.moderation}
        </p>
      )}
      {error === "underage" && (
        <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          {format(t.errors.underage, { age: MIN_AGE })}
        </p>
      )}

      <form action={completeOnboarding} className="mt-6 space-y-5">
        <div>
          <label htmlFor="onboarding-name" className="block text-sm font-medium">
            {t.name} <span className="text-danger">*</span>
          </label>
          <input
            id="onboarding-name"
            name="name"
            required
            minLength={2}
            maxLength={60}
            autoComplete="name"
            defaultValue={user.name ?? ""}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>

        <div>
          <label htmlFor="onboarding-bio" className="block text-sm font-medium">
            {t.bio} <span className="font-normal text-foreground-soft">{t.optional}</span>
          </label>
          <textarea
            id="onboarding-bio"
            name="bio"
            maxLength={500}
            rows={3}
            defaultValue={user.bio ?? ""}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium">
            {t.birthDate} <span className="text-danger">*</span>
          </label>
          <div className="mt-1">
            <BirthDateSelect
              defaultValue={user.birthDate?.toISOString().slice(0, 10)}
              minAge={MIN_AGE}
              labels={dictionary.shared.birthDate}
            />
          </div>
          <p className="mt-1 text-xs text-foreground-soft">{format(t.ageHint, { age: MIN_AGE })}</p>
        </div>

        <div>
          <label htmlFor="onboarding-country" className="block text-sm font-medium">
            {t.country} <span className="text-danger">*</span>
          </label>
          <select
            id="onboarding-country"
            name="country"
            required
            autoComplete="country-name"
            defaultValue={user.country ?? ""}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          >
            <option value="" disabled>
              {t.countryPlaceholder}
            </option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {countryName(c, locale)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium">
            {t.languages} <span className="text-danger">*</span>
          </label>
          <p className="mt-0.5 text-xs text-foreground-soft">{t.languagesHint}</p>
          <div className="mt-1">
            <MultiSelect
              name="languages"
              options={LANGUAGES.map((l) => ({
                value: l,
                label: languageName(l, locale, dictionary.vocab.languages),
              }))}
              defaultValues={user.languages}
              placeholder={t.languagesPlaceholder}
              max={10}
              labels={dictionary.shared.multiSelect}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium">
            {t.interests} <span className="text-danger">*</span>
          </label>
          <p className="mt-0.5 text-xs text-foreground-soft">{t.interestsHint}</p>
          <div className="mt-1">
            <MultiSelect
              name="interests"
              options={INTERESTS.map((i) => ({ value: i, label: interestName(i, dictionary.vocab.interests) }))}
              defaultValues={user.interests}
              placeholder={t.interestsPlaceholder}
              max={15}
              labels={dictionary.shared.multiSelect}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium">
            {t.intentsLabel} <span className="text-danger">*</span>
          </label>
          <p className="mt-0.5 text-xs text-foreground-soft">{t.intentsHint}</p>
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
                {t.intents[tag]}
              </label>
            ))}
          </div>
        </div>

        <SubmitButton
          label={t.submit}
          pendingLabel={t.submitting}
          offlineMessage={dictionary.shared.submitButton.offline}
          className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
        />
      </form>

      <LanguagePicker locale={locale} label={dictionary.languagePicker.label} />
    </div>
  );
}
