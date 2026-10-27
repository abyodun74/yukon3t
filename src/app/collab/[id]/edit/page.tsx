import { notFound, redirect } from "next/navigation";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { updateCollabPost } from "@/app/actions/collab";
import { isCollabAdmin, getCollabMembership } from "@/lib/collab-permissions";
import { BackButton } from "@/components/back-button";
import { CollabCountriesField } from "@/components/collab-countries-field";
import { CollabScheduleField } from "@/components/collab-schedule-field";
import { CollabSubmitButton } from "@/components/collab-submit-button";
import { MultiSelect } from "@/components/multi-select";
import { COLLAB_TYPES } from "@/lib/collab-types";
import { vocabName } from "@/lib/i18n/language-names";
import { byCode } from "@/lib/i18n/locales";
import { getDictionary } from "@/lib/i18n/server";
import { GuestGatedScreen } from "@/components/guest-preview";

export default async function EditCollabPostPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  // Members only: a guest preview session (src/lib/guest-preview.ts) sees why, and how to join.
  if (me.isGuestPreview) return <GuestGatedScreen kind="create" />;
  const { id } = await params;
  const { error } = await searchParams;
  const dictionary = await getDictionary();
  const t = dictionary.collab.form;
  // The stored value is the English name; only the label a type is shown under follows the reader's language.
  const typeOptions = COLLAB_TYPES.map((type) => ({ value: type, label: vocabName(type, dictionary.vocab.collabTypes) }));

  const collab = await prisma.collabBoardPost.findUnique({ where: { id } });
  if (!collab) notFound();

  const membership = await getCollabMembership(id, me.id);
  if (!isCollabAdmin(collab, membership, me)) {
    redirect(`/collab/${id}`);
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-14">
      <BackButton fallbackHref={`/collab/${id}`} />
      <h1 className="mt-1 text-2xl font-semibold">{t.editTitle}</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        {t.editIntro}
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          {byCode(t.editErrors, error)}
        </p>
      )}

      <form action={updateCollabPost.bind(null, id)} className="mt-6 space-y-4">
        <div>
          <label htmlFor="collab-edit-title" className="block text-sm font-medium">
            {t.title}
          </label>
          <input
            id="collab-edit-title"
            name="title"
            dir="auto"
            required
            minLength={5}
            maxLength={100}
            defaultValue={collab.title}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">{t.type}</label>
          <div className="mt-1">
            <MultiSelect
              name="type"
              options={typeOptions}
              defaultValues={[collab.type]}
              placeholder={t.typePlaceholder}
              max={1}
              labels={dictionary.shared.multiSelect}
            />
          </div>
        </div>
        <CollabCountriesField defaultWorldwide={collab.worldwide} defaultCountries={collab.countries} />
        <CollabScheduleField defaultDays={collab.scheduleDays} defaultTime={collab.scheduleTime} />
        <div>
          <label htmlFor="collab-edit-description" className="block text-sm font-medium">
            {t.description}
          </label>
          <textarea
            id="collab-edit-description"
            name="description"
            dir="auto"
            required
            minLength={20}
            maxLength={2000}
            rows={5}
            defaultValue={collab.description}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <CollabSubmitButton label={t.save} pendingLabel={t.saving} />
      </form>
    </div>
  );
}
