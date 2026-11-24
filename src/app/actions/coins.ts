"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { getCoinBalance, grantCoins } from "@/lib/coin-wallet";
import { grantRefusal } from "@/lib/coins";
import { coinGrantSchema } from "@/lib/validations";

// Y3T Coins: the admin grant (/admin/coins). The ONLY way coins come into existence: nobody can buy them. Admin-only
// (requireAdmin), and every grant is written to the ledger and the audit log (COINS_GRANTED) in the same transaction
// as the wallet credit (src/lib/coin-wallet.ts grantCoins). The form carries a one-time id, so a double submit grants
// once.

/** Grants coins to one person, found by their exact username or user id. Answers by redirecting back with the outcome. */
export async function grantCoinsAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = coinGrantSchema.safeParse({
    recipient: formData.get("recipient"),
    amount: formData.get("amount"),
    reason: formData.get("reason"),
    formId: formData.get("formId"),
  });
  if (!parsed.success) redirect("/admin/coins?error=invalid");
  const { recipient, amount, reason, formId } = parsed.data;
  const handle = recipient.replace(/^@/, "");
  // Exact match only, never a fuzzy one for a grant: a user id first, then the username exactly as stored (both unique).
  const select = { id: true, status: true, isGuestPreview: true } as const;
  const target =
    (await prisma.user.findUnique({ where: { id: handle }, select })) ??
    (await prisma.user.findUnique({ where: { username: handle }, select }));
  if (!target || target.isGuestPreview || target.status !== "ACTIVE") redirect("/admin/coins?error=recipient");
  if (grantRefusal(amount, await getCoinBalance(target.id)) === "balance_cap") redirect("/admin/coins?error=balance_cap");

  const outcome = await grantCoins({ adminId: admin.id, userId: target.id, amount, reason, formId });
  revalidatePath("/admin/coins");
  switch (outcome.outcome) {
    case "granted":
      redirect(`/admin/coins?granted=${amount}`);
    case "duplicate":
      redirect("/admin/coins?duplicate=1");
    case "balance_cap":
      redirect("/admin/coins?error=balance_cap");
    default:
      redirect("/admin/coins?error=invalid");
  }
}
