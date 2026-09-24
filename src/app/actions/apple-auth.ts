"use server";

import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";
import { getClientIp } from "@/lib/client-ip";
import { verifyTurnstile } from "@/lib/turnstile";

/**
 * Shared by both /sign-in and /sign-up — Apple's own OAuth flow doesn't
 * distinguish the two the way this app's password path does (create vs.
 * log in): the *first* time a given Apple account authorizes, the Prisma
 * adapter creates the User row itself (from whatever name/email Apple
 * hands back); every time after that it's just a login. Either way lands
 * on /home, same as sendMagicLink's own redirectTo, for the same reason —
 * a first-time OAuth/magic-link user has no name/country/interests yet,
 * which getOnboardedUserOrRedirect (src/lib/page-guards.ts) already checks
 * generically on every protected page and bounces to /onboarding for,
 * regardless of which provider created the account.
 */
export async function startAppleSignIn(formData: FormData) {
  const ip = await getClientIp();
  // Sent as a hidden field by AppleSignInButton so a Turnstile failure
  // redirects back to whichever page (/sign-in or /sign-up) the button was
  // actually rendered on, not always /sign-in.
  const returnPath = formData.get("returnPath") === "/sign-up" ? "/sign-up" : "/sign-in";
  // Same reasoning as sendMagicLink's own Turnstile check (src/app/sign-in/
  // page.tsx) — route.ts's own doc comment on the /api/auth/signin/* block
  // names this as the intended way to add an OAuth button: a
  // Turnstile-verified server action calling signIn(), not the raw
  // NextAuth HTTP route directly.
  if (!(await verifyTurnstile(formData, ip))) {
    redirect(`${returnPath}?error=apple_captcha`);
  }
  await signIn("apple", { redirectTo: "/home" });
}
