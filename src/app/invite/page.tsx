import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { BackButton } from "@/components/back-button";
import { InvitePanel } from "@/components/invite-panel";

export default async function InvitePage() {
  await getOnboardedUserOrRedirect();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <BackButton />
      <h1 className="mt-4 text-2xl font-semibold">Invite friends</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        Bring people you know onto YuKon3t.
      </p>
      <div className="mt-6">
        <InvitePanel />
      </div>
    </div>
  );
}
