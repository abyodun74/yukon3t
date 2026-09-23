import Script from "next/script";
import { headers } from "next/headers";

/**
 * Google Tag Manager bootstrap snippet — inert (renders nothing) until its
 * env var is set (see .env.example). Carries the per-request CSP nonce
 * (src/proxy.ts sets it on the x-nonce request header) so it satisfies
 * script-src under 'strict-dynamic' without needing 'unsafe-inline';
 * strict-dynamic then lets its own dynamically-inserted <script src> load
 * regardless of host.
 *
 * Session replay + product analytics is PostHog (src/components/posthog-
 * provider.tsx), not a snippet here — posthog-js is a bundled npm package,
 * not an inline-script bootstrap like this or the Microsoft Clarity
 * snippet this replaced.
 */
export async function AnalyticsScripts() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const gtmId = process.env.NEXT_PUBLIC_GTM_ID;

  return (
    <>
      {gtmId && (
        <Script id="gtm-bootstrap" strategy="afterInteractive" nonce={nonce}>
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmId}');`}
        </Script>
      )}
    </>
  );
}

/** GTM's no-JS fallback — must be the first element after <body> per Google's own install instructions. */
export function GtmNoScript() {
  const gtmId = process.env.NEXT_PUBLIC_GTM_ID;
  if (!gtmId) return null;
  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${gtmId}`}
        height="0"
        width="0"
        style={{ display: "none", visibility: "hidden" }}
      />
    </noscript>
  );
}
