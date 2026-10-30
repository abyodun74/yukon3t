// Audit L6 (2026-10-29): a "shared material" arrives over a Daily app-message, which any call participant can send
// with any content, and is rendered as a link, an <img> or an <iframe> (global-call-frame.tsx). Only a file uploaded
// through shareCollabMaterial is accepted: an https URL under our media bucket's public base, in `collab-material/`.

/** Content types a Collab material can have (storage.ts CONTENT_TYPE_ALLOWLIST["collab-material"]). */
const COLLAB_MATERIAL_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function isCollabMaterialUrl(url: string, mediaBaseUrl: string | null | undefined): boolean {
  if (!mediaBaseUrl) return false;
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(mediaBaseUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.origin !== base.origin) return false;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return false;
  const basePath = base.pathname.replace(/\/$/, "");
  const prefix = `${basePath}/collab-material/`;
  if (!parsed.pathname.startsWith(prefix)) return false;
  // `collab-material/<uploaderId>/<file>` exactly, nothing that walks out of it.
  const rest = parsed.pathname.slice(prefix.length).split("/");
  return rest.length === 2 && rest.every((p) => p.length > 0 && p !== ".." && p !== ".");
}

export function isCollabMaterialContentType(contentType: string): boolean {
  return COLLAB_MATERIAL_TYPES.has(contentType);
}
