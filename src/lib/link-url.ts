/**
 * Validates and normalizes a URL for storage as a plain LINK post/message
 * attachment — used only as an `<a href>` target, never an iframe src (see
 * video-embed.ts for that), so there's no id-extraction/allowlist involved
 * here, just a protocol check to keep out `javascript:`/`data:` etc.
 */
export function normalizeLinkUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return url.toString();
}
