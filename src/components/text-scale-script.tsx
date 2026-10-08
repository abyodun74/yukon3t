import { headers } from "next/headers";
import { TEXT_SCALE_SCRIPT } from "@/lib/text-scale";

/**
 * Inlines the iOS text-size script (see src/lib/text-scale.ts for what it
 * does and why) as a plain parser-blocking <script>, so it has set the root
 * font size before the browser paints anything — a next/script would load
 * after hydration and the whole page would visibly resize.
 *
 * Carries the per-request CSP nonce (src/proxy.ts sets it on the x-nonce
 * request header, same as AnalyticsScripts) so it satisfies script-src
 * without 'unsafe-inline'. suppressHydrationWarning follows Next's own
 * "preventing flash before hydration" guide for an inline script rendered
 * through React; the matching one on <html> in layout.tsx is what lets the
 * inline font-size this script writes there survive hydration silently.
 */
export async function TextScaleScript() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: TEXT_SCALE_SCRIPT }} />;
}
