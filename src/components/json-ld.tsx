import { serializeJsonLd } from "@/lib/seo";

/**
 * Structured data for search engines, rendered on the server. A data block, not a script: the browser never runs it,
 * so the CSP nonce isn't needed. serializeJsonLd escapes <, > and &, so no string in it can close the element.
 */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
