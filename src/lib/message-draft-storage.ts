// Per-conversation, per-device unsent-message text — read/written by
// chat-thread.tsx so a draft survives switching to another conversation,
// navigating away entirely, or reloading the page, and is only cleared once
// the message actually sends. Scoped by userId (not just conversationId) so
// a draft never leaks between two accounts signed in on the same shared
// device/browser. Deliberately plain localStorage, no try/catch — same
// unguarded style as feed-video-mute.ts/call-foreground-native.ts elsewhere
// in this app; a private-browsing quota error here is a no-op draft, not a
// broken send, so it's not worth the extra code to swallow explicitly.
const STORAGE_PREFIX = "yukon3t:draft:";

function storageKey(userId: string, conversationId: string): string {
  return `${STORAGE_PREFIX}${userId}:${conversationId}`;
}

/** Empty string (not null) when there's no saved draft, or during SSR — matches the composer's own controlled-textarea default. */
export function getDraft(userId: string, conversationId: string): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(storageKey(userId, conversationId)) ?? "";
}

/** Call on every composer keystroke; an empty string removes the key instead of storing "" forever. */
export function setDraft(userId: string, conversationId: string, text: string): void {
  if (typeof window === "undefined") return;
  const key = storageKey(userId, conversationId);
  if (text) {
    window.localStorage.setItem(key, text);
  } else {
    window.localStorage.removeItem(key);
  }
}

/**
 * Removes every saved draft for this user — call on sign-out (nav.tsx's
 * handleSignOut, alongside its existing FCM_TOKEN_STORAGE_KEY cleanup) so a
 * shared/public device doesn't keep a departing account's unsent message
 * text sitting in localStorage indefinitely.
 */
export function clearDraftsForUser(userId: string): void {
  if (typeof window === "undefined") return;
  const ownPrefix = `${STORAGE_PREFIX}${userId}:`;
  const staleKeys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key?.startsWith(ownPrefix)) staleKeys.push(key);
  }
  for (const key of staleKeys) window.localStorage.removeItem(key);
}
