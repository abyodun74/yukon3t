"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { markReadByTarget } from "@/app/actions/notifications";

/**
 * Visiting the place a notification leads to marks it read — however the
 * user got there: the Messages tab, a link to the post, a web-push tap
 * (public/sw.js just opens the URL), not only its row in the list. Without
 * this the bell badge kept counting a message whose conversation had already
 * been read, or a like on a post already opened.
 *
 * A URL only says where the reader landed, not what they then saw, so two kinds are cleared on the server at the
 * moment they are actually seen instead: a chat's MESSAGE rows by getConversationMessages (also a message arriving
 * while the thread is open, and Collab chats, whose thread is on /collab/<id>), and a story's SUBSCRIPTION_STORY row
 * by viewStory (also stories reached from the Home tray or swiped on to in the viewer, which never change the URL).
 *
 * Asks only while something is unread, and once per URL. `unreadCount` is a
 * dependency so that a page reached before the badge count has loaded (a
 * cold start from a push tap) is still covered when the count arrives.
 *
 * useSearchParams() because several targets differ only in the query string
 * (?channel=, ?story= — see notification-href.ts), which usePathname() alone
 * never reports. It needs the Suspense boundary nav.tsx wraps this in.
 */
export function NotificationReadOnVisit({ unreadCount }: { unreadCount: number }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const url = search ? `${pathname}?${search}` : pathname;
  const markedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (markedForRef.current === url) return;
    markedForRef.current = null;
    // The list itself is where they get opened one by one.
    if (unreadCount <= 0 || pathname === "/notifications") return;
    markedForRef.current = url;
    markReadByTarget(url).catch(() => {});
  }, [url, pathname, unreadCount]);

  return null;
}
