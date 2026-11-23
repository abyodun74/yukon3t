// Per-submission keys that make a write idempotent: the browser makes one per thing it sends (a post, a chat message),
// reuses it for every retry of that same thing, and the server answers a key it has already stored with what it
// stored instead of creating a second copy (Post.clientRequestId, Message.clientRequestId). Client-safe.

/** The client's key (a UUID or similar), or null when absent or malformed. */
export function parseClientRequestId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,64}$/.test(value) ? value : null;
}

/** A fresh key, accepted by parseClientRequestId. */
export function newClientRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
