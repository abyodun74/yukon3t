import { NextResponse } from "next/server";
import { clearHiddenUnlockCookie } from "@/lib/hidden-chats";

/**
 * Re-locks the hidden-chats area. A real endpoint rather than only the lockHiddenChats action because it is called
 * with navigator.sendBeacon as the page is being hidden (HiddenRelock), the one kind of request a browser still
 * delivers from a page it is suspending. It only ever removes access, so it needs no session and no CSRF check.
 */
export async function POST() {
  await clearHiddenUnlockCookie();
  return new NextResponse(null, { status: 204 });
}
