import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { getHiddenPeerIds } from "@/lib/hidden-chats";
import { createCollabPost } from "@/app/actions/collab";
import { CollabCreateForm } from "@/components/collab-create-form";
import { parseCollabFields } from "@/lib/collab-form-errors";
import { COLLAB_TYPES } from "@/lib/collab-types";
import { vocabName } from "@/lib/i18n/language-names";
import { getDictionary, getLocale } from "@/lib/i18n/server";
import { getOwnedCircleOptions } from "@/lib/collab-circle-options";
import { GuestGatedScreen } from "@/components/guest-preview";

export default async function NewCollabPostPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; fields?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  // Members only: a guest preview session (src/lib/guest-preview.ts) sees why, and how to join.
  if (me.isGuestPreview) return <GuestGatedScreen kind="create" />;
  const { error, fields } = await searchParams;
  const dictionary = await getDictionary();
  const locale = await getLocale();
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
  const circleCandidates = await getOwnedCircleOptions(me.id, locale, dictionary.collab.invites.circleMembers);

  return (
    <div className="mx-auto max-w-lg px-4 py-14">
      <h1 className="text-2xl font-semibold">{t.newTitle}</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        {t.newIntro}
      </p>

      <CollabCreateForm
        action={createCollabPost}
        errorCode={error ?? null}
        initialFields={parseCollabFields(fields)}
        typeOptions={typeOptions}
        inviteeCandidates={inviteeCandidates}
        circleCandidates={circleCandidates}
      />
    </div>
  );
}
