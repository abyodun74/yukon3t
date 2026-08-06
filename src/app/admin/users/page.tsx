import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { AdminSendResetButton } from "@/components/admin-send-reset-button";
import { AdminDeleteUserButton } from "@/components/admin-delete-user-button";

/** Support tool: look up an account and send them a password reset link — for a customer who can't complete their own reset, or is locked out and doesn't want to wait 24h. */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const admin = await getSessionUserOrRedirect();
  if (!admin.isAdmin) redirect("/discover");

  const { q } = await searchParams;
  const query = q?.trim();

  const users = query
    ? await prisma.user.findMany({
        where: {
          OR: [
            { email: { contains: query, mode: "insensitive" } },
            { username: { contains: query, mode: "insensitive" } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          email: true,
          username: true,
          name: true,
          status: true,
          emailVerified: true,
          lockedUntil: true,
          failedLoginAttempts: true,
          isAdmin: true,
        },
      })
    : [];

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/admin/moderation" className="text-xs text-foreground-soft hover:text-accent">
        &larr; Moderation queue
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Users</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        Look up an account by email or username to send them a password
        reset link — for a customer having trouble resetting their own
        password, or who&apos;s locked out after too many failed attempts.
      </p>

      <form className="mt-6 flex items-center gap-2">
        <input
          type="text"
          name="q"
          defaultValue={query}
          placeholder="Email or username"
          className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="shrink-0 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink"
        >
          Search
        </button>
      </form>

      <div className="mt-6 space-y-3">
        {users.map((u) => {
          const isLocked = !!u.lockedUntil && u.lockedUntil > new Date();
          return (
            <div key={u.id} className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {u.name ?? u.username ?? "(no name set)"}
                  </p>
                  <p className="text-xs text-foreground-soft">
                    {u.email}
                    {u.username && ` · @${u.username}`}
                  </p>
                  <p className="mt-1 text-xs text-foreground-soft">
                    {u.status} · {u.emailVerified ? "email verified" : "email not verified"}
                    {isLocked && (
                      <span className="text-danger">
                        {" "}
                        · locked until {u.lockedUntil!.toLocaleString()}
                      </span>
                    )}
                    {!isLocked && u.failedLoginAttempts > 0 && (
                      <span> · {u.failedLoginAttempts} recent failed login attempt(s)</span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <AdminSendResetButton userId={u.id} />
                  {!u.isAdmin && u.id !== admin.id && (
                    <AdminDeleteUserButton userId={u.id} handle={u.username ?? u.email} />
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {query && users.length === 0 && (
          <p className="text-sm text-foreground-soft">No accounts match &quot;{query}&quot;.</p>
        )}
        {!query && (
          <p className="text-sm text-foreground-soft">Search for an account to get started.</p>
        )}
      </div>
    </div>
  );
}
