import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { getHiddenPeerIds } from "@/lib/hidden-chats";
import { createCollabPost } from "@/app/actions/collab";
import { CollabCountriesField } from "@/components/collab-countries-field";
import { CollabScheduleField } from "@/components/collab-schedule-field";
import { CollabSubmitButton } from "@/components/collab-submit-button";
import { CollabVisibilityField } from "@/components/collab-visibility-field";
import { MultiSelect } from "@/components/multi-select";
import { COLLAB_TYPES } from "@/lib/collab-types";
import { vocabName } from "@/lib/i18n/language-names";
import { byCode } from "@/lib/i18n/locales";
import { getDictionary } from "@/lib/i18n/server";

export default async function NewCollabPostPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { error } = await searchParams;
  const dictionary = await getDictionary();
  const t = dictionary.collab.form;
  // The stored value is the English name; only the label a type is shown under follows the reader's language.
  const typeOptions = COLLAB_TYPES.map((type) => ({ value: type, label: vocabName(type, dictionary.vocab.collabTypes) }));

  // Candidates for a private collab's invite list — same "my accepted
  // connections" query messages/[id]/page.tsx uses for group-add candidates.
  const accepted = await prisma.connection.findMany({
    where: { status: "ACCEPTED", OR: [{ requesterId: me.id }, { targetId: me.id }] },
    include: {
      requester: { select: { id: true, name: true } },
      target: { select: { id: true, name: true } },
    },
  });
  const hiddenPeerIds = new Set(await getHiddenPeerIds(me.id));
  const inviteeCandidates = accepted
    .map((c) => (c.requesterId === me.id ? c.target : c.requester))
    .filter((other) => !hiddenPeerIds.has(other.id))
    .map((other) => ({ value: other.id, label: other.name ?? t.unknown }));

  return (
    <div className="mx-auto max-w-lg px-4 py-14">
      <h1 className="text-2xl font-semibold">{t.newTitle}</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        {t.newIntro}
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          {byCode(t.errors, error)}
        </p>
      )}

      <form action={createCollabPost} className="mt-6 space-y-4">
        <div>
          <label htmlFor="collab-title" className="block text-sm font-medium">
            {t.title}
          </label>
          <input
            id="collab-title"
            name="title"
            dir="auto"
            required
            minLength={5}
            maxLength={100}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">{t.type}</label>
          <p className="mt-0.5 text-xs text-foreground-soft">{t.typeHint}</p>
          <div className="mt-1">
            <MultiSelect
              name="type"
              options={typeOptions}
              placeholder={t.typePlaceholder}
              max={1}
              labels={dictionary.shared.multiSelect}
            />
          </div>
        </div>
        <CollabCountriesField />
        <CollabVisibilityField candidates={inviteeCandidates} />
        <CollabScheduleField />
        <div>
          <label htmlFor="collab-description" className="block text-sm font-medium">
            {t.description}
          </label>
          <p className="mt-0.5 text-xs text-foreground-soft">{t.descriptionHint}</p>
          <textarea
            id="collab-description"
            name="description"
            dir="auto"
            required
            minLength={20}
            maxLength={2000}
            rows={5}
            placeholder={t.descriptionPlaceholder}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <CollabSubmitButton label={t.submit} pendingLabel={t.submitting} />
      </form>
    </div>
  );
}
