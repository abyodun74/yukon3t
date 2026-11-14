import { NextResponse, type NextRequest } from "next/server";
import { requestUploadUrls } from "@/app/actions/media";
import { AuthError } from "@/lib/auth-guards";
import { isSameOriginUploadRequest } from "@/lib/upload-route-guard";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Presigned upload URLs for the composers, as a plain route rather than the requestUploadUrls Server Action the
 * browser used to call: a tab's Server Actions run one at a time with no timeout, so one that never settled (an iPhone
 * request suspended with the app) blocked every later upload until the app was reloaded. The client calls this with
 * its own timeout and abort (upload-client.ts). Same checks as the action, which it calls: member guard, write-once
 * protocol, batch schema, per-item upload limiter. Plus the same-origin guard (upload-route-guard.ts).
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginUploadRequest(request.headers)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400, headers: NO_STORE });
  }
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const items = Array.isArray(input.items) ? (input.items as { kind: string; contentType: string }[]) : [];
  const protocol = typeof input.protocol === "string" ? input.protocol : undefined;
  try {
    const result = await requestUploadUrls(items, protocol);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
    }
    console.error("[uploads/presign] failed", err);
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}
