// Public-bucket media is write-once (security audit H3). A presigned PUT stays valid for minutes (images) or hours
// (videos) after the file it was minted for has been uploaded, moderated and published, so without a condition the
// same URL could replace a moderated photo or video with anything. Every single-PUT URL storage.ts's createUploadUrl
// mints therefore signs `If-None-Match: *`: R2 accepts the first PUT (200) and refuses every later one with
// 412 Precondition Failed (verified against the production R2 account). The header is part of the signature, so a
// PUT without it fails the signature check (403): the server hands these headers back with every URL and the client
// sends them as given. Multipart uploads need none of this: their part URLs die with the upload id on completion.
// Kept free of server-only and client-only imports: storage.ts (server) and upload-client.ts (browser) both use it.

import { isRetryableStatus } from "@/lib/fetch-retry";

/** The headers every PUT to a createUploadUrl URL must send, exactly. */
export const WRITE_ONCE_PUT_HEADERS: Readonly<{ "If-None-Match": "*" }> = Object.freeze({ "If-None-Match": "*" });

/**
 * Sent by the current client with every request for public upload URLs. A client bundle from before write-once
 * uploads (a tab or app session left open across the deploy) doesn't send it and would PUT without the header, which
 * R2 refuses as a bad signature with nothing useful to show; the server answers it with "stale_deployment" instead,
 * which every composer already shows as "new version available, reopen".
 */
export const WRITE_ONCE_UPLOAD_PROTOCOL = "write-once-1";
/** The form field that carries WRITE_ONCE_UPLOAD_PROTOCOL where the request is a FormData (the public ad flow). */
export const WRITE_ONCE_UPLOAD_PROTOCOL_FIELD = "uploadProtocol";

export type PutAttemptOutcome = "ok" | "retry" | "failed";

/**
 * What one attempt's response status means for a write-once PUT.
 *  - 2xx: stored.
 *  - 412 on a retry (attempt >= 2): an earlier attempt of this same upload already stored the object and only its
 *    response was lost (timeout, dropped connection), so the key is written and the upload counts as done. The server
 *    still HEADs the object (owner, size) before anything uses it.
 *  - 412 on the first attempt: the key was already written before this client ever sent anything, i.e. not by this
 *    upload. Never treated as success.
 *  - 408/425/429/5xx: transient, try again.
 *  - anything else (403 expired or bad signature, 400): final.
 */
export function putAttemptOutcome(status: number, attempt: number): PutAttemptOutcome {
  if (status >= 200 && status <= 299) return "ok";
  if (status === 412) return attempt >= 2 ? "ok" : "failed";
  if (isRetryableStatus(status)) return "retry";
  return "failed";
}
