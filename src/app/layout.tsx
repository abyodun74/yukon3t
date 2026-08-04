import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { Nav } from "@/components/nav";
import { RegisterServiceWorker } from "@/components/register-sw";
import { OfflineBanner } from "@/components/offline-banner";
import { IncomingCallListener } from "@/components/incoming-call-listener";
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
        className={`min-h-full flex flex-col bg-background text-foreground ${session?.user ? "pb-16 md:pb-0" : ""}`}
      >
        <RegisterServiceWorker />
        <OfflineBanner />
        <Nav session={session} theme={theme} />
        {session?.user && <IncomingCallListener />}
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line py-8 text-center text-sm text-foreground-soft">
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
          </div>
          <p className="mt-3">© {new Date().getFullYear()} YuKon3t</p>
        </footer>
      </body>
    </html>
  );
}
