import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { createGroupChat } from "@/app/actions/messages";
import { MultiSelect } from "@/components/multi-select";
import { BackButton } from "@/components/back-button";
import { getHiddenPeerIds } from "@/lib/hidden-chats";
import { getDictionary } from "@/lib/i18n/server";
import { GuestGatedScreen } from "@/components/guest-preview";

export default async function NewGroupChatPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  // Members only: a guest preview session (src/lib/guest-preview.ts) sees why, and how to join.
  if (me.isGuestPreview) return <GuestGatedScreen kind="messages" />;
  const { error } = await searchParams;
  const messages = (await getDictionary()).messages;
  const t = messages.newGroup;

  const accepted = await prisma.connection.findMany({
    where: {
      status: "ACCEPTED",
      OR: [{ requesterId: me.id }, { targetId: me.id }],
    },
    include: {
      requester: { select: { id: true, name: true } },
      target: { select: { id: true, name: true } },
    },
    orderBy: { respondedAt: "desc" },
  });
  const hiddenPeerIds = new Set(await getHiddenPeerIds(me.id));
  const connections = accepted
    .map((c) => (c.requesterId === me.id ? c.target : c.requester))
    .filter((u) => !hiddenPeerIds.has(u.id));

  return (
    <div className="mx-auto max-w-lg px-4 py-14">
      <BackButton fallbackHref="/messages/discover" label={messages.back} />
      <h1 className="mt-4 text-2xl font-semibold">{t.title}</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        {t.intro}
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          {error === "rate_limited" || error === "moderation" ? t.errors[error] : t.errors.invalid}
        </p>
      )}

      {connections.length < 2 ? (
        <p className="mt-6 text-sm text-foreground-soft">
          {t.tooFew}
        </p>
      ) : (
        <form action={createGroupChat} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium">{t.name}</label>
            <input
              aria-label={t.name}
              dir="auto"
              name="name"
              required
              minLength={2}
              maxLength={60}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">{t.members}</label>
            <div className="mt-1">
              <MultiSelect
                name="memberIds"
                options={connections.map((c) => ({ value: c.id, label: c.name ?? messages.fallback.unknown }))}
                placeholder={messages.controls.multiSelect.placeholder}
                labels={messages.controls.multiSelect}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
            <input type="checkbox" name="discoverable" defaultChecked />
            {t.discoverable}
          </label>
          <button
            type="submit"
            className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
          >
            {t.submit}
          </button>
        </form>
      )}
    </div>
  );
}
