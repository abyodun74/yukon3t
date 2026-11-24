import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { grantCoinsAction } from "@/app/actions/coins";
import { COIN_BALANCE_MAX, COIN_GRANT_MAX, COIN_GRANT_REASON_MAX } from "@/lib/coins";

// Y3T Coins: the admin grant tool. Coins are granted by YuKon3t only (nobody can buy them); each grant is credited,
// written to the coin ledger and to the audit log (COINS_GRANTED) in one transaction (src/lib/coin-wallet.ts). Admin
// pages stay English.

/** A fresh one-time id for the form (a double submit of the same form grants once). Outside render, for the purity rule. */
function newFormId() {
  return randomUUID();
}

const MESSAGES: Record<string, string> = {
  invalid: "Check the form: a recipient, a whole amount between 1 and 100,000 and a reason (3 to 200 characters).",
  recipient: "No active account has that exact username or id.",
  balance_cap: `That would take the balance above ${COIN_BALANCE_MAX.toLocaleString("en")} coins.`,
};

export default async function AdminCoinsPage({
  searchParams,
}: {
  searchParams: Promise<{ granted?: string; duplicate?: string; error?: string }>;
}) {
  const user = await getSessionUserOrRedirect();
  if (!user.isAdmin) redirect("/discover");
  const params = await searchParams;

  const grants = await prisma.coinLedgerEntry.findMany({
    where: { kind: "GRANT" },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      amount: true,
      balanceAfter: true,
      reason: true,
      grantedById: true,
      createdAt: true,
      user: { select: { name: true, username: true } },
    },
  });
  const adminIds = [...new Set(grants.map((g) => g.grantedById).filter((id): id is string => Boolean(id)))];
  const admins = adminIds.length
    ? await prisma.user.findMany({ where: { id: { in: adminIds } }, select: { id: true, name: true, username: true } })
    : [];
  const adminName = new Map(admins.map((a) => [a.id, a.username ?? a.name ?? a.id]));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/admin/system" className="text-xs text-accent hover:underline">
        System
      </Link>
      <h1 className="mt-1 text-xl font-semibold">Y3T Coins</h1>
      <p className="mt-2 text-sm text-foreground-soft">
        Coins are granted by YuKon3t only: there is no way for anyone to buy them. They have no cash value, can&apos;t be
        transferred or cashed out, and are only spent on gifts. Every grant is recorded in the coin ledger and the audit
        log under your account. Gifts (and so coins) are currently on for site admins only.
      </p>

      {params.granted && (
        <p role="status" className="mt-4 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-success">
          Granted {Number(params.granted).toLocaleString("en")} coins.
        </p>
      )}
      {params.duplicate && (
        <p role="status" className="mt-4 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
          That form was already submitted: nothing was granted twice.
        </p>
      )}
      {params.error && (
        <p role="alert" className="mt-4 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-danger">
          {MESSAGES[params.error] ?? "Something went wrong."}
        </p>
      )}

      <form action={grantCoinsAction} className="mt-6 space-y-3 rounded-xl border border-line p-4">
        <input type="hidden" name="formId" value={newFormId()} />
        <label className="block text-sm font-medium">
          Recipient (exact username or user id)
          <input
            name="recipient"
            required
            maxLength={64}
            autoComplete="off"
            className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-base sm:text-sm"
          />
        </label>
        <label className="block text-sm font-medium">
          Amount (1 to {COIN_GRANT_MAX.toLocaleString("en")})
          <input
            name="amount"
            type="number"
            required
            min={1}
            max={COIN_GRANT_MAX}
            step={1}
            className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-base sm:text-sm"
          />
        </label>
        <label className="block text-sm font-medium">
          Reason (recorded in the audit log)
          <input
            name="reason"
            required
            minLength={3}
            maxLength={COIN_GRANT_REASON_MAX}
            className="mt-1 w-full rounded-lg border border-line bg-background px-3 py-2 text-base sm:text-sm"
          />
        </label>
        <button type="submit" className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-ink">
          Grant coins
        </button>
      </form>

      <h2 className="mt-8 text-sm font-semibold">Recent grants</h2>
      {grants.length === 0 ? (
        <p className="mt-2 text-sm text-foreground-soft">No grants yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
          {grants.map((g) => (
            <li key={g.id} className="px-3 py-2 text-sm">
              <span className="font-medium">+{g.amount.toLocaleString("en")}</span> to{" "}
              {g.user.username ? `@${g.user.username}` : (g.user.name ?? "an account")} (balance {g.balanceAfter.toLocaleString("en")})
              <span className="block text-xs text-foreground-soft">
                {g.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC by{" "}
                {g.grantedById ? (adminName.get(g.grantedById) ?? "a removed admin") : "unknown"}: {g.reason}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
