import { redirect } from "next/navigation";
import { requireUser, AuthError } from "@/lib/auth-guards";

/**
 * For server components/pages: redirects to /sign-in when not authenticated.
 * Delegates to requireUser() so page loads and server actions enforce the
 * exact same status/session-revocation check from a single place.
 */
export async function getSessionUserOrRedirect() {
  try {
    return await requireUser();
  } catch (error) {
    if (error instanceof AuthError) {
      redirect("/sign-in");
    }
    throw error;
  }
}

function isProfileComplete(user: { name: string | null; country: string | null; interests: string[] }) {
  return Boolean(user.name && user.country && user.interests.length > 0);
}

/** Like getSessionUserOrRedirect, but also forces onboarding completion first. */
export async function getOnboardedUserOrRedirect() {
  const user = await getSessionUserOrRedirect();
  if (!isProfileComplete(user)) {
    redirect("/onboarding");
  }
  return user;
}

export { isProfileComplete };
