import { UserLink } from "@/components/user-link";

type Member = {
  role: string;
  user: { id: string; name: string | null; username?: string | null; avatarUrl?: string | null };
};

/**
 * Read-only counterpart to CircleMemberManager — every member (not just the
 * owner/co-admins) can see who else belongs to the Circle, they just can't
 * act on anyone here. Rendered instead of the manager for a plain member;
 * an owner/co-admin gets the manager itself, which already lists everyone
 * too, so this never renders alongside it.
 */
export function CircleMemberList({ members }: { members: Member[] }) {
  if (members.length === 0) {
    return <p className="text-sm text-foreground-soft">No members yet.</p>;
  }

  return (
    <ul className="divide-y divide-line">
      {members.map((m) => (
        <li key={m.user.id} className="flex items-center gap-1.5 py-2 text-sm">
          <UserLink userId={m.user.id} name={m.user.name} username={m.user.username} avatarUrl={m.user.avatarUrl} />
          {m.role === "OWNER" && <span className="text-xs font-normal text-accent">Owner</span>}
          {m.role === "MODERATOR" && <span className="text-xs font-normal text-accent">Co-admin</span>}
        </li>
      ))}
    </ul>
  );
}
