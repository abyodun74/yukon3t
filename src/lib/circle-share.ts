// Sharing a Circle (long press / right-click on a Circle card, or the Share button on its page): the pure rules, shared
// by the server action (shareCircleToConversations in src/app/actions/share-to-chats.ts), the sheet
// (circle-share-sheet.tsx) and the tests. Client-safe: no database, no server-only imports.
//
// Owner rule (2026-11-13): only a PUBLIC Circle is shared. A PRIVATE Circle "doesn't exist for non-members"
// (src/lib/circle-visibility.ts) and is invite-only, so its sheet offers no share action at all (only a pointer to the
// admins' Invite flow) and the server answers a generic "unavailable" for it, so a crafted request can't put a private
// Circle's name into a chat.

import { INVITE_ORIGIN } from "@/lib/invite-link";

/** Every shared Circle link uses the canonical production host (never a preview / *.netlify.app origin). */
export const CIRCLE_SHARE_ORIGIN = INVITE_ORIGIN;

/** May this Circle be shared through chats, the device share sheet or a copied link? PUBLIC ones only. */
export function isCircleShareable(circle: { visibility: string }): boolean {
  return circle.visibility === "PUBLIC";
}

/** https://yukon3t.com/circles/<slug> */
export function circleShareUrl(slug: string): string {
  return `${CIRCLE_SHARE_ORIGIN}/circles/${encodeURIComponent(slug)}`;
}

/**
 * The chat message a Circle share writes: the Circle's name, then its link alone on its own line (so every client
 * makes it tappable). Language-neutral: no sentence around it, so it reads the same to every recipient. Only what a
 * non-member can already see of a PUBLIC Circle: no member count, description or picture.
 */
export function circleShareMessage(circle: { name: string; slug: string }): string {
  const name = circle.name.replace(/\s+/g, " ").trim();
  const url = circleShareUrl(circle.slug);
  return name ? `${name}\n${url}` : url;
}
