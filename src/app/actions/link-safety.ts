"use server";

import { requireVerifiedUser } from "@/lib/auth-guards";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkLinkSafety, type LinkSafetyResult } from "@/lib/link-safety";

/** Called from LinkSafetyModal right before a shared link is followed. */
export async function checkLinkBeforeOpen(url: string): Promise<LinkSafetyResult> {
  const user = await requireVerifiedUser();

  const allowed = await checkRateLimit("linkSafetyCheck", user.id);
  if (!allowed) {
    return { status: "unknown" };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { status: "unknown" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { status: "unknown" };
  }

  return checkLinkSafety(parsed.toString());
}
