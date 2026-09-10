import Script from "next/script";
import { headers } from "next/headers";

/**
 * Google Tag Manager + Microsoft Clarity bootstrap snippets. Both are inert
 * (render nothing) until their env var is set — see .env.example. Each
 * snippet carries the per-request CSP nonce (src/proxy.ts sets it on the
 * x-nonce request header) so it satisfies script-src under 'strict-dynamic'
 * without needing 'unsafe-inline'; strict-dynamic then lets each snippet's
 * own dynamically-inserted <script src> load regardless of host.
 */
export async function AnalyticsScripts() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const gtmId = process.env.NEXT_PUBLIC_GTM_ID;
  const clarityId = process.env.NEXT_PUBLIC_CLARITY_ID;

  return (
    <>
      {gtmId && (
        <Script id="gtm-bootstrap" strategy="afterInteractive" nonce={nonce}>
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmId}');`}
        </Script>
      )}
      {clarityId && (
        <Script id="clarity-bootstrap" strategy="afterInteractive" nonce={nonce}>
          {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${clarityId}");`}
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
