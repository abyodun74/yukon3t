import { NextRequest, NextResponse } from "next/server";
import { handlers } from "@/lib/auth";

export const { GET } = handlers;

/**
 * Auth.js exposes `POST /api/auth/signin/:provider` (magic link via "resend",
 * and Google if AUTH_GOOGLE_* is ever set) to anyone with a CSRF token from
 * `GET /api/auth/csrf`. Nothing in this app calls it: sign-in starts from the
 * sign-in page's own server actions, which call `signIn()` from
 * src/lib/auth.ts in-process (Auth.js builds a Request and runs it directly,
 * no HTTP hop — see next-auth/lib/actions.js), after the Turnstile check and
 * per-email rate limit those actions carry.
 *
 * Left open, this route is a way around both: a script could fetch a CSRF
 * token and POST any email straight to it, triggering a magic-link email with
 * no Turnstile and none of the per-email limiting. So direct HTTP sign-in
 * starts are refused. Everything else under /api/auth stays as-is — the
 * emailed link's callback (`GET /api/auth/callback/resend`), OAuth callbacks,
 * `signout`, `session` and `csrf` all still work.
 *
 * If a Google (or other OAuth) button is ever added, start it from a server
 * action that verifies Turnstile and then calls `signIn("google")`, the same
 * way sendMagicLink does in src/app/sign-in/page.tsx.
 */
export async function POST(request: NextRequest) {
  if (new URL(request.url).pathname.startsWith("/api/auth/signin/")) {
    return new NextResponse("Not found", { status: 404 });
  }
  return handlers.POST(request);
}
