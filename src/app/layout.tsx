import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import { cookies } from "next/headers";
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
import { auth } from "@/lib/auth";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "YuKon3t — Connect across cultures, interests, and borders",
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
  // Both native shells deliberately render edge-to-edge under the status
  // bar/notch (capacitor.config.ts's iOS contentInset: "automatic", and
  // Android's StatusBar plugin default of overlaysWebView: true) rather than
  // leaving a hard gap above the page. Without `viewport-fit=cover` in the
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
        className={`min-h-full flex flex-col bg-background text-foreground isolate ${session?.user ? "pb-16 md:pb-0" : ""}`}
      >
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
          {session?.user && <IncomingCallListener />}
          {session?.user && <GlobalCallFrame />}
          {session?.user && <FcmTokenBridge />}
          {session?.user && <PresenceHeartbeat />}
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
              <a href="/advertise" className="hover:text-accent">
                Advertise
              </a>
            </div>
            <p className="mt-3">© {new Date().getFullYear()} YuKon3t</p>
          </footer>
        </CallSessionProvider>
      </body>
    </html>
  );
}
