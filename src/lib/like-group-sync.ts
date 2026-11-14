"use client";

import { useEffect, useRef } from "react";

/**
 * Keeps every on-screen card of one like group (src/lib/like-groups.ts: one person's Muse and their own feed copy of
 * the same video; groups are single-author) in step: Home stays mounted under the Muse viewer, so a like in the viewer
 * must show on the same group's post card underneath. Cards of different groups (someone else's copy of the video,
 * which has its own group or none) never take each other's changes. The card that changed announces the server's answer
 * (the caller's liked state and the group's count); every other card of the group takes it. Same tab only, like
 * rsvp-sync.ts; nothing leaves the page.
 */

const EVENT_NAME = "yk:like-group-changed";

export type LikeGroupChange = {
  likeGroupId: string;
  /** Whether the caller now likes the group. */
  liked: boolean;
  /** The group's distinct-liker count, shown on every member. */
  likeCount: number;
  /** Identifies the announcing card, which ignores its own announcement. */
  source: symbol;
};

export function announceLikeGroup(change: LikeGroupChange) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<LikeGroupChange>(EVENT_NAME, { detail: change }));
}

/**
 * Whether a card listening on `listening` takes `change`: only another card's announcement, and only for its own group
 * (`"any"`: a list holding many cards, which filters per card by likeGroupId itself). Groups are single-author, so a
 * card never takes a change from someone else's copy of the same video.
 */
export function likeGroupChangeApplies(
  listening: string | null | "any",
  source: symbol,
  change: LikeGroupChange | null | undefined,
): change is LikeGroupChange {
  if (!listening || !change || change.source === source) return false;
  return listening === "any" || change.likeGroupId === listening;
}

/**
 * Calls `onChange` for every change announced by another card. `likeGroupId` narrows it to one group (a card); null
 * listens to nothing; omit it (`"any"`) to hear every group (a list that holds many cards).
 */
export function useLikeGroupSync(
  likeGroupId: string | null | "any",
  source: symbol,
  onChange: (change: LikeGroupChange) => void,
) {
  const handler = useRef(onChange);
  useEffect(() => {
    handler.current = onChange;
  });
  useEffect(() => {
    if (!likeGroupId) return;
    function listener(e: Event) {
      const change = (e as CustomEvent<LikeGroupChange>).detail;
      if (likeGroupChangeApplies(likeGroupId, source, change)) handler.current(change);
    }
    window.addEventListener(EVENT_NAME, listener);
    return () => window.removeEventListener(EVENT_NAME, listener);
  }, [likeGroupId, source]);
}
