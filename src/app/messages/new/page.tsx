import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { createGroupChat } from "@/app/actions/messages";
import { MultiSelect } from "@/components/multi-select";

export default async function NewGroupChatPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { error } = await searchParams;

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
  const connections = accepted.map((c) => (c.requesterId === me.id ? c.target : c.requester));

  return (
    <div className="mx-auto max-w-lg px-4 py-14">
      <h1 className="text-2xl font-semibold">Start a group chat</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        Pick at least 2 connections to add, plus a name for the group.
      </p>

      {error && (
        <p className="mt-4 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          {error === "rate_limited"
            ? "You're creating groups too fast — try again in an hour."
            : error === "moderation"
              ? "That group name didn't pass our content guidelines."
              : "Please check your inputs."}
        </p>
      )}

      {connections.length < 2 ? (
        <p className="mt-6 text-sm text-foreground-soft">
          You need at least 2 connections to start a group.
        </p>
      ) : (
        <form action={createGroupChat} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium">Group name</label>
            <input
              name="name"
              required
              minLength={2}
              maxLength={60}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Members</label>
            <div className="mt-1">
              <MultiSelect
                name="memberIds"
                options={connections.map((c) => ({ value: c.id, label: c.name ?? "Unknown" }))}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
            <input type="checkbox" name="discoverable" defaultChecked />
            Make this group discoverable — anyone can find it and request to join
            (on by default; uncheck for an invite-only group)
          </label>
          <button
            type="submit"
            className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink"
          >
            Create group
          </button>
        </form>
      )}
    </div>
  );
}
