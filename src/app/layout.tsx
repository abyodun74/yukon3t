import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { Nav } from "@/components/nav";
import { AppSplash } from "@/components/app-splash";
import { RegisterServiceWorker } from "@/components/register-sw";
import { OfflineBanner } from "@/components/offline-banner";
import { IncomingCallListener } from "@/components/incoming-call-listener";
import { GlobalCallFrame } from "@/components/global-call-frame";
import { CallSessionProvider } from "@/lib/call-session";
import { FcmTokenBridge } from "@/components/fcm-token-bridge";
import { PresenceHeartbeat } from "@/components/presence-heartbeat";
import { CapacitorBridge } from "@/components/capacitor-bridge";
import { ScreenshotGuard } from "@/components/screenshot-guard";
import { FeedVideoVolumeSync } from "@/components/feed-video-volume-sync";
import { ShareTargetGate } from "@/components/share-target-gate";
import { ReviewPromptGate } from "@/components/review-prompt-gate";
import { AnalyticsScripts, GtmNoScript } from "@/components/analytics-scripts";
import { PostHogProvider } from "@/components/posthog-provider";
import { auth } from "@/lib/auth";
import { HideInIosApp } from "@/components/hide-in-ios-app";
import { isLikelyIosAppUserAgent } from "@/lib/ios-app";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://yukon3t.com";

// Self-hosted (next/font/local) instead of next/font/google — a Netlify
// production build started failing outright (`next/font`'s Google fetch:
// "TypeError: Cannot read properties of null (reading '1')" in
// next-font-loader) on 2026-09-23, well after this app had built fine for
// months, with no code change of ours involved: Google Fonts itself
// resolved fine from elsewhere, so this looks like Netlify's own build
// infrastructure having trouble reaching fonts.gstatic.com, not a real
// content/config problem. next/font/google fetches font files over the
// network at *build* time regardless of runtime caching, so any such
// network hiccup — Netlify's, Google's, or anything in between — fails the
// whole production build outright. Self-hosting removes that build-time
// network dependency entirely; the files themselves (see
// src/app/fonts/*.woff2, downloaded from the exact same Google Fonts URLs
// this app was already using) are unchanged from what was being served
// before, so nothing about the actual typography changes.
const geistSans = localFont({
  src: "./fonts/Geist-Variable.woff2",
  weight: "100 900",
  variable: "--font-geist-sans",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-Variable.woff2",
  weight: "100 900",
  variable: "--font-geist-mono",
});

const fraunces = localFont({
  src: [
    { path: "./fonts/Fraunces-Variable.woff2", weight: "500 700", style: "normal" },
    { path: "./fonts/Fraunces-Italic-Variable.woff2", weight: "500 700", style: "italic" },
  ],
  variable: "--font-fraunces",
});

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "YuKon3t — Connect across cultures, interests, and borders",
    // Pages that set their own title (via `title: "..."` in a page-level
    // metadata export) get "<page title> | YuKon3t" instead of replacing
    // the brand entirely — search results and browser tabs stay
    // identifiable as YuKon3t even from a deep link.
    template: "%s | YuKon3t",
  },
  description:
    "YuKon3t connects people worldwide through verified communities, cross-cultural friendship, and cross-country collaboration.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "YuKon3t",
  },
  // Falls back to Next's own default (no verification meta tag rendered)
  // until these are actually set — see .env.example.
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
    other: process.env.BING_SITE_VERIFICATION
      ? { "msvalidate.01": process.env.BING_SITE_VERIFICATION }
      : undefined,
  },
  openGraph: {
    type: "website",
    url: appUrl,
    siteName: "YuKon3t",
    title: "YuKon3t — Connect across cultures, interests, and borders",
    description:
      "YuKon3t connects people worldwide through verified communities, cross-cultural friendship, and cross-country collaboration.",
    images: [{ url: "/icons/icon-512.png", width: 512, height: 512 }],
  },
  twitter: {
    card: "summary",
    title: "YuKon3t — Connect across cultures, interests, and borders",
    description:
      "YuKon3t connects people worldwide through verified communities, cross-cultural friendship, and cross-country collaboration.",
    images: ["/icons/icon-512.png"],
  },
  other: {
    // iOS Safari only honors the legacy vendor-prefixed tag for standalone
    // launch mode — Next's `appleWebApp.capable` only emits the newer
    // unprefixed `mobile-web-app-capable`, which Android/Chrome reads but
    // iOS ignores.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  // Next.js only emits the framework's default `width=device-width,
  // initial-scale=1` viewport meta tag when this export is absent — once we
  // provide our own `viewport` object (for themeColor below), it replaces
  // the default wholesale rather than merging with it. Without these two
  // fields the page shipped with no viewport meta tag at all, so mobile
  // WebViews (confirmed on the Android/Capacitor build) fell back to a
  // desktop-width layout viewport and rendered the whole app zoomed out and
  // off-center, clipping content symmetrically at both edges once
  // globals.css's `overflow-x: hidden` kicked in.
  width: "device-width",
  initialScale: 1,
  // Without this, the browser/WebView's own native page-pinch-zoom stays
  // fully enabled everywhere, competing with (and on Android WebView,
  // often winning over) ZoomableImage's own JS-driven pinch handling for
  // the actual two-finger touch events — `touch-action: none` on that
  // component's own container isn't reliably enough on its own to suppress
  // *native pinch* specifically across WebView versions, only panning/
  // scroll. This is the standard fix for "my custom pinch gesture does
  // nothing": disable native page zoom globally (nothing in this app wants
  // the whole page to zoom) so touch events reach JS uncontested, and let
  // Lightbox's ZoomableImage be the only pinch-zoom surface.
  maximumScale: 1,
  userScalable: false,
  // Both native shells deliberately render edge-to-edge under the status
  // bar/notch (capacitor.config.ts's iOS contentInset: "never" — WKWebView's
  // own "automatic" inset handling fought with this same CSS-based approach
  // and was dropped for it, see that file's own comment — and Android's
  // StatusBar plugin default of overlaysWebView: true) rather than leaving a
  // hard gap above the page. Without `viewport-fit=cover` in the
  // meta tag, though, `env(safe-area-inset-*)` reports 0 everywhere — the
  // spec only populates it once the layout viewport is told it's allowed to
  // extend into the safe area — so nothing in the app could actually react
  // to the notch/status bar/home indicator. This is what makes those env()
  // values usable (see live-stream-room.tsx's top-anchored overlays for the
  // first real consumer).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f2" },
    { media: "(prefers-color-scheme: dark)", color: "#14181a" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const iosApp = isLikelyIosAppUserAgent((await headers()).get("user-agent"));
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html
      lang="en"
      data-theme={theme === "system" ? undefined : theme}
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body
        // `isolate` gives body its own stacking context so the aurora
        // background's `position: fixed; z-index: -1` (globals.css) stacks
        // correctly above body's own background paint instead of escaping
        // to the root and rendering behind it — see the comment there.
        //
        // The reserved bottom padding has to grow by the same inset
        // nav.tsx's bottom tab bar now pads itself with (Galaxy Fold
        // edge-to-edge fix) — otherwise that bar's now-taller box covers a
        // bit more of the last on-screen content than this padding leaves
        // room for. max(env(...), var(--safe-area-inset-bottom)) — see
        // nav.tsx's own comment on why the plain env() alone isn't enough.
        className={`min-h-full flex flex-col bg-background text-foreground isolate ${session?.user ? "pb-[calc(4rem_+_max(env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px)))] md:pb-0" : ""}`}
      >
        <GtmNoScript />
        <AnalyticsScripts />
        <PostHogProvider userId={session?.user?.id} />
        <div className="aurora-bg" aria-hidden>
          <div className="aurora-blob" />
          <div className="aurora-blob" />
          <div className="aurora-blob" />
        </div>
        <CallSessionProvider>
          <AppSplash />
          <CapacitorBridge />
          <RegisterServiceWorker />
          <OfflineBanner />
          <Nav session={session} theme={theme} />
          {session?.user && <IncomingCallListener currentUserId={session.user.id} />}
          {session?.user && <GlobalCallFrame />}
          {session?.user && <FcmTokenBridge />}
          {session?.user && <PresenceHeartbeat />}
          {session?.user && <ScreenshotGuard />}
          {session?.user && <FeedVideoVolumeSync />}
          {session?.user && <ShareTargetGate userId={session.user.id} />}
          {session?.user && <ReviewPromptGate />}
          <main className="flex-1">{children}</main>
          {/* Signed-in mobile users already have a dedicated bottom tab bar
              (nav.tsx's `md:hidden` nav, reserved for via body's pb-16
              above) covering navigation — this marketing-site-style footer
              (FAQ/legal links) has no reason to also appear there. Confirmed
              live via a real user's screenshot: it was rendering between the
              message composer and that tab bar on an actual conversation
              screen, pure clutter competing for scarce phone-screen height.
              Signed-out visitors (landing/legal/FAQ pages) and desktop still
              get it — hidden only for the case that's actually a problem. */}
          <footer
            className={`border-t border-line py-8 text-center text-sm text-foreground-soft ${session?.user ? "hidden md:block" : ""}`}
          >
            <div className="mx-auto flex max-w-5xl flex-wrap justify-center gap-4 px-4">
              <a href="/faq" className="hover:text-accent">
                FAQ
              </a>
              <a href="/legal/guidelines" className="hover:text-accent">
                Community Guidelines
              </a>
              <a href="/legal/privacy" className="hover:text-accent">
                Privacy
              </a>
              <a href="/legal/terms" className="hover:text-accent">
                Terms
              </a>
              <a href="/legal/disclaimer" className="hover:text-accent">
                Disclaimer
              </a>
              {/* Ad booking is a web/Stripe business purchase — not surfaced inside the iOS app (see HideInIosApp). */}
              <HideInIosApp hiddenOnServer={iosApp}>
                <a href="/advertise" className="hover:text-accent">
                  Advertise
                </a>
              </HideInIosApp>
            </div>
            <p className="mt-3">© {new Date().getFullYear()} YuKon3t</p>
          </footer>
        </CallSessionProvider>
      </body>
    </html>
  );
}
