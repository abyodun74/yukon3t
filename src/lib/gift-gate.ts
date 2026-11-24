import { notFound } from "next/navigation";
import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { giftsEnabledFor } from "@/lib/gifts";

/**
 * The one access check for every /gift-marketplace surface: signed in (a real 307 to /sign-in otherwise), then
 * giftsEnabledFor (today: site admins only; false for the guest preview), else notFound(). The marketplace layout
 * runs it BEFORE reading or serializing the gifts dictionary, so nobody outside the gate receives gift wording;
 * each page runs it again (a layout alone doesn't guard its route segments).
 */
export async function requireGiftsUser() {
  const user = await getSessionUserOrRedirect();
  if (!giftsEnabledFor(user)) notFound();
  return user;
}
