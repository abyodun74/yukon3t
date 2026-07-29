import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { Nav } from "@/components/nav";
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

export const metadata: Metadata = {
  title: "YuKon3t — Connect across cultures, interests, and borders",
  description:
    "YuKon3t connects people worldwide through verified communities, cross-cultural friendship, and cross-country collaboration.",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Nav session={session} theme={theme} />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line py-8 text-center text-sm text-foreground-soft">
          <div className="mx-auto flex max-w-5xl flex-wrap justify-center gap-4 px-4">
            <a href="/legal/guidelines" className="hover:text-accent">
              Community Guidelines
            </a>
            <a href="/legal/privacy" className="hover:text-accent">
              Privacy
            </a>
            <a href="/legal/terms" className="hover:text-accent">
              Terms
            </a>
          </div>
          <p className="mt-3">© {new Date().getFullYear()} YuKon3t</p>
        </footer>
      </body>
    </html>
  );
}
