// Sharing a Collab (long press / right-click on a Collab card, or the Share button on its page): the pure rules, shared
// by the server action (shareCollabToConversations in src/app/actions/share-to-chats.ts), the sheet
// (collab-share-sheet.tsx) and the tests. Client-safe: no database, no server-only imports.
//
// Owner rule (2026-11-15, "the same way Circles can be shared"): only a PUBLIC, OPEN collab is shared.
// - A PRIVATE collab is invite-only (its admins use the Invite flow on its page), so its sheet offers no share action
//   at all and the server answers a generic "unavailable" for it, so a crafted request can't put a private collab's
//   title into a chat.
// - A CLOSED collab is not shared either: closing is how an organizer ends it AND how moderation removes one
//   (removeModeratedContent sets CLOSED; the model has no separate REMOVED state), and the two can't be told apart.

import { CANONICAL_ORIGIN } from "@/lib/app-links";

/** May this collab be shared through chats, the device share sheet or a copied link? PUBLIC and OPEN ones only. */
export function isCollabShareable(collab: { visibility: string; status: string }): boolean {
  return collab.visibility === "PUBLIC" && collab.status === "OPEN";
}

/** https://yukon3t.com/collab/<id>: the canonical production host (never a preview / *.netlify.app origin). */
export function collabShareUrl(id: string): string {
  return `${CANONICAL_ORIGIN}/collab/${encodeURIComponent(id)}`;
}

/**
 * The chat message a Collab share writes: the collab's title, then its link alone on its own line (so every client
 * makes it tappable). Language-neutral: no sentence around it. Only what a non-participant can already see of a PUBLIC
 * collab's card: no participant count, description, schedule or picture.
 */
export function collabShareMessage(collab: { title: string; id: string }): string {
  const title = collab.title.replace(/\s+/g, " ").trim();
  const url = collabShareUrl(collab.id);
  return title ? `${title}\n${url}` : url;
}
