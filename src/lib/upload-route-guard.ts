// CSRF guard for the cookie-authenticated POST routes the composers call with fetch() instead of a Server Action
// (/api/uploads/presign, /api/posts; see post-submit-attempt.ts for why they exist). Server Actions get Next.js's own
// Origin-vs-Host check; these routes get the same check plus a custom header. A cross-site page can't send a custom
// header without a CORS preflight, which these routes never answer, so a forged cross-site form or fetch is refused
// even from a browser that omits Origin. Pure and client-safe (the client imports the header name).

export const UPLOAD_ROUTE_HEADER = "x-yk-upload";

type HeaderReader = { get(name: string): string | null };

/** The host the request was sent to, the way Next.js's Server Action check reads it (x-forwarded-host first). */
function requestHost(headers: HeaderReader): string | null {
  const forwarded = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  return forwarded || headers.get("host") || null;
}

export function isSameOriginUploadRequest(headers: HeaderReader): boolean {
  if (headers.get(UPLOAD_ROUTE_HEADER) !== "1") return false;
  const origin = headers.get("origin");
  if (origin === null) return true; // same-origin requests may omit it; the custom header already proves no cross-site form
  if (origin === "null") return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const host = requestHost(headers);
  return host !== null && originHost === host;
}
