import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { getPasswordHash } from "@/lib/auth-guards";
import { BackButton } from "@/components/back-button";
import { HiddenChatsPanel } from "@/components/hidden-chats-panel";
import { HiddenRelock } from "@/components/hidden-relock";
import { getHiddenPinState, isHiddenUnlocked } from "@/lib/hidden-chats";
import { safeHiddenNext } from "@/lib/hidden-chats-rules";
import { getInboxItems } from "@/lib/inbox-items";
import { getDictionary } from "@/lib/i18n/server";
import { GuestGatedScreen } from "@/components/guest-preview";

export default async function HiddenChatsPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  // Members only: a guest preview session (src/lib/guest-preview.ts) sees why, and how to join.
  if (me.isGuestPreview) return <GuestGatedScreen kind="messages" />;
  const { next } = await searchParams;

  const hasPin = Boolean((await getHiddenPinState(me.id)).hiddenChatsPinHash);
  const unlocked = hasPin && (await isHiddenUnlocked(me.id));
  const t = (await getDictionary()).messages;
  const items = unlocked ? await getInboxItems(me.id, "hidden", t.fallback) : [];

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      {unlocked && <HiddenRelock />}
      <BackButton fallbackHref="/messages" label={t.back} />
      <h1 className="mt-4 text-2xl font-semibold">{t.hidden.title}</h1>
      <div className="mt-5">
        <HiddenChatsPanel
          state={!hasPin ? "no_pin" : unlocked ? "unlocked" : "locked"}
          hasPassword={Boolean(await getPasswordHash(me.id))}
          items={items}
          next={safeHiddenNext(next)}
        />
      </div>
    </div>
  );
}
