import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth-guards";
import { endCall } from "@/app/actions/calls";
import { NATIVE_CALL_HEADER, parseNativeCallEndRequest } from "@/lib/native-call-request";

/**
 * CallKit's End on a call answered on the iOS app, reported by its native side (NativeCallManager.swift) with the web
 * view's own session cookie, so the call is hung up even while WebKit has the page suspended (phone locked by the
 * side button, app in the background). Authorisation and every guard are endCall's own: this route only translates.
 * See src/lib/native-call-request.ts.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const parsed = parseNativeCallEndRequest(request.headers.get(NATIVE_CALL_HEADER), body);
  if (!parsed) return NextResponse.json({ error: "invalid" }, { status: 400 });

  try {
    const result = await endCall(parsed.callId, parsed.device);
    return NextResponse.json({ error: result.error ?? null });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    throw err;
  }
}
