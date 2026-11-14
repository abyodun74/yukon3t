import { NextResponse, type NextRequest } from "next/server";
import { createPost } from "@/app/actions/circles";
import { AuthError } from "@/lib/auth-guards";
import { isSameOriginUploadRequest } from "@/lib/upload-route-guard";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * createPost for PostComposer, as a plain route the browser calls with its own timeout and abort
 * (post-create-client.ts) instead of through the tab's Server Action queue, which has neither: one createPost that
 * never settled on an iPhone blocked every later post attempt until the app was reloaded (post-submit-attempt.ts).
 * The body is the composer's FormData, unchanged; createPost does every check itself (member guard, idempotency on
 * clientRequestId before the limiter, rate limit, device step-up, validation, moderation) and its answer is returned as
 * JSON. Plus the same-origin guard (upload-route-guard.ts).
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginUploadRequest(request.headers)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400, headers: NO_STORE });
  }
  try {
    const result = await createPost(formData);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
    }
    // Not a verdict: createPost threw part-way (it may or may not have stored the post), so the client retries with
    // the same clientRequestId, which createPost answers with success if the post exists.
    console.error("[api/posts] createPost threw", err);
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}
