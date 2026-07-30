"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Compass, Users, Handshake, MessageCircle, User } from "lucide-react";
import type { Session } from "next-auth";
import { signOutAction } from "@/app/actions/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import type { Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

function navLinks(userId: string) {
  return [
    { href: "/discover", label: "Discover" },
    { href: "/circles", label: "Circles" },
    { href: "/collab", label: "Collab Boards" },
    { href: "/connections", label: "Connections" },
    { href: "/messages", label: "Messages" },
    { href: `/u/${userId}`, label: "Profile" },
  ];
}

// The 5 primary destinations, shown as a fixed bottom bar on small screens
// (Instagram/WhatsApp/TikTok pattern) — Connections moves into the
// secondary hamburger menu to keep this to 5 tabs.
function bottomTabs(userId: string) {
  return [
    { href: "/discover", label: "Discover", icon: Compass },
    { href: "/circles", label: "Circles", icon: Users },
    { href: "/collab", label: "Collab", icon: Handshake },
    { href: "/messages", label: "Messages", icon: MessageCircle },
    { href: `/u/${userId}`, label: "Profile", icon: User },
  ];
}

export function Nav({ session, theme }: { session: Session | null; theme: Theme }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const links = session?.user ? navLinks(session.user.id) : [];
  const tabs = session?.user ? bottomTabs(session.user.id) : [];

  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link
            href="/"
            onClick={() => setOpen(false)}
            className="text-lg font-semibold tracking-tight text-accent"
          >
            YuKon3t
          </Link>

          {links.length > 0 && (
            <nav className="hidden gap-5 text-sm font-medium text-foreground-soft md:flex">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "hover:text-accent",
                    pathname === link.href && "text-accent",
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          )}

          <div className="flex items-center gap-3">
            <div className="hidden sm:block">
              <ThemeToggle initial={theme} />
            </div>
            {session?.user ? (
              <>
                <Link
                  href="/settings"
                  className="hidden text-sm text-foreground-soft hover:text-accent sm:inline"
                >
                  Settings
                </Link>
                {session.user.isAdmin && (
                  <Link
                    href="/admin/moderation"
                    className="hidden text-sm text-foreground-soft hover:text-accent sm:inline"
                  >
                    Moderation
                  </Link>
                )}
                <form action={signOutAction} className="hidden sm:block">
                  <button
                    type="submit"
                    className="rounded-full border border-line px-3 py-1.5 text-sm hover:border-accent hover:text-accent"
                  >
                    Sign out
                  </button>
                </form>
                <button
                  type="button"
                  aria-label={open ? "Close menu" : "Open menu"}
                  aria-expanded={open}
                  onClick={() => setOpen((v) => !v)}
                  className="rounded-lg p-1.5 text-foreground-soft hover:bg-line md:hidden"
                >
                  {open ? <X size={20} /> : <Menu size={20} />}
                </button>
              </>
            ) : (
              <Link
                href="/sign-in"
                className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>

        {open && session?.user && (
          <div className="border-t border-line px-4 py-3 md:hidden">
            <nav className="flex flex-col gap-1 text-sm font-medium">
              <Link
                href="/connections"
                onClick={() => setOpen(false)}
                className={cn(
                  "rounded-lg px-3 py-2 hover:bg-line",
                  pathname === "/connections" ? "text-accent" : "text-foreground-soft",
                )}
              >
                Connections
              </Link>
              <div className="my-2 border-t border-line" />
              <Link
                href="/settings"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2 text-foreground-soft hover:bg-line"
              >
                Settings
              </Link>
              {session.user.isAdmin && (
                <Link
                  href="/admin/moderation"
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2 text-foreground-soft hover:bg-line"
                >
                  Moderation
                </Link>
              )}
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-foreground-soft">Theme</span>
                <ThemeToggle initial={theme} />
              </div>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-left hover:border-accent hover:text-accent"
                >
                  Sign out
                </button>
              </form>
            </nav>
          </div>
        )}
      </header>

      {tabs.length > 0 && (
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface md:hidden">
          {tabs.map((tab) => {
            const active = pathname === tab.href;
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-2 text-[11px]",
                  active ? "text-accent" : "text-foreground-soft",
                )}
              >
                <Icon size={20} strokeWidth={active ? 2.5 : 2} />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      )}
    </>
  );
}
