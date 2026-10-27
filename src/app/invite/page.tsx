import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { BackButton } from "@/components/back-button";
import { InvitePanel } from "@/components/invite-panel";
import { getRequestCountry } from "@/lib/request-country";
import { getDictionary } from "@/lib/i18n/server";
import { GuestGatedScreen } from "@/components/guest-preview";

export default async function InvitePage() {
  const viewer = await getOnboardedUserOrRedirect();
  // Members only: a guest preview session (src/lib/guest-preview.ts) sees why, and how to join.
  if (viewer.isGuestPreview) return <GuestGatedScreen kind="create" />;
  const dictionary = await getDictionary();
  const t = dictionary.invite;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <BackButton label={dictionary.shell.common.back} />
      <h1 className="mt-4 text-2xl font-semibold">{t.title}</h1>
      <p className="mt-1 text-sm text-foreground-soft">{t.intro}</p>
      <div className="mt-6">
        <InvitePanel defaultCountry={await getRequestCountry()} />
      </div>
    </div>
  );
}
