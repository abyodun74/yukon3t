"use server";

import { signOut } from "@/lib/auth";
import { clearHiddenUnlockCookie } from "@/lib/hidden-chats";

export async function signOutAction() {
  await clearHiddenUnlockCookie();
  await signOut({ redirectTo: "/" });
}
