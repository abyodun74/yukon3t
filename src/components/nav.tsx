"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Home, Users, Handshake, MessageCircle, User } from "lucide-react";
import type { Session } from "next-auth";
import { signOutAction } from "@/app/actions/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/components/notification-bell";
import { usePolling } from "@/lib/use-polling";
import type { Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 25_000;

/**
 * Polls a `{ count }` JSON endpoint — shared by the messages and connections
 * nav badges. Both are mounted in Nav for every signed-in user on every
 * page, so this pauses while the tab isn't visible via the same
 * `usePolling` mechanism as NotificationBell/ChatThread/CircleVoiceRoom,
 * rather than a plain always-on `setInterval`.
 */
function usePolledCount(url: string, enabled: boolean) {
  const [count, setCount] = useState(0);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      setCount(data.count ?? 0);
    } catch {
      // A failed poll should not be visible to the user — try again next tick.
    }
  }, [url]);

  usePolling(poll, POLL_INTERVAL_MS, enabled);

  return count;
}

/** How many conversations have an unread message, for the Messages nav badge. */
function useUnreadMessagesCount(enabled: boolean) {
  return usePolledCount("/api/messages/unread-count", enabled);
}

/** How many incoming connection requests are still awaiting a response, for the Connections nav badge. */
function usePendingConnectionsCount(enabled: boolean) {
  return usePolledCount("/api/connections/pending-count", enabled);
}

function navLinks(userId: string) {
  return [
    { href: "/home", label: "Home" },
    { href: "/discover", label: "Discover" },
    { href: "/circles", label: "Circles" },
    { href: "/collab", label: "Collab Boards" },
    { href: "/connections", label: "Connections" },
    { href: "/messages", label: "Messages" },
    { href: `/u/${userId}`, label: "Profile" },
  ];
}

// The 5 primary destinations, shown as a fixed bottom bar on small screens
// (Instagram/WhatsApp/TikTok pattern) — Connections and Discover move into
// the secondary hamburger menu to keep this to 5 tabs.
function bottomTabs(userId: string) {
  return [
    { href: "/home", label: "Home", icon: Home },
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
  const unreadMessages = useUnreadMessagesCount(Boolean(session?.user));
  const pendingConnections = usePendingConnectionsCount(Boolean(session?.user));

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 shadow-[var(--shadow-sm)] backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link
            href="/"
            onClick={() => setOpen(false)}
            className="font-display text-xl font-semibold tracking-tight text-accent"
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
                    "relative rounded-full px-3 py-1.5 hover:bg-accent-soft hover:text-accent",
                    pathname === link.href && "bg-accent-soft text-accent",
                  )}
                >
                  {link.label}
                  {link.href === "/messages" && unreadMessages > 0 && (
                    <span className="absolute -right-2 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-semibold text-white">
                      {unreadMessages > 9 ? "9+" : unreadMessages}
                    </span>
                  )}
                  {link.href === "/connections" && pendingConnections > 0 && (
                    <span className="absolute -right-2 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-semibold text-white">
                      {pendingConnections > 9 ? "9+" : pendingConnections}
                    </span>
                  )}
                </Link>
              ))}
            </nav>
          )}

          <div className="flex items-center gap-3">
            <div className="hidden sm:block">
              <ThemeToggle initial={theme} />
            </div>
            {session?.user && <NotificationBell />}
            {session?.user ? (
              <>
                <Link
                  href="/faq"
                  className="hidden text-sm text-foreground-soft hover:text-accent sm:inline"
                >
                  FAQ
                </Link>
                <Link
                  href="/settings"
                  className="hidden text-sm text-foreground-soft hover:text-accent sm:inline"
                >
                  Settings
                </Link>
                {session.user.isAdmin && (
                  <>
                    <Link
                      href="/admin/moderation"
                      className="hidden text-sm text-foreground-soft hover:text-accent sm:inline"
                    >
                      Moderation
                    </Link>
                    <Link
                      href="/admin/circles"
                      className="hidden text-sm text-foreground-soft hover:text-accent sm:inline"
                    >
                      Circles (admin)
                    </Link>
                    <Link
                      href="/admin/analytics"
                      className="hidden text-sm text-foreground-soft hover:text-accent sm:inline"
                    >
                      Analytics
                    </Link>
                    <Link
                      href="/admin/users"
                      className="hidden text-sm text-foreground-soft hover:text-accent sm:inline"
                    >
                      Users
                    </Link>
                  </>
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
                href="/discover"
                onClick={() => setOpen(false)}
                className={cn(
                  "rounded-lg px-3 py-2 hover:bg-line",
                  pathname === "/discover" ? "text-accent" : "text-foreground-soft",
                )}
              >
                Discover
              </Link>
              <Link
                href="/connections"
                onClick={() => setOpen(false)}
                className={cn(
                  "relative rounded-lg px-3 py-2 hover:bg-line",
                  pathname === "/connections" ? "text-accent" : "text-foreground-soft",
                )}
              >
                Connections
                {pendingConnections > 0 && (
                  <span className="ml-2 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-semibold text-white">
                    {pendingConnections > 9 ? "9+" : pendingConnections}
                  </span>
                )}
              </Link>
              <div className="my-2 border-t border-line" />
              <Link
                href="/faq"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2 text-foreground-soft hover:bg-line"
              >
                FAQ
              </Link>
              <Link
                href="/settings"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2 text-foreground-soft hover:bg-line"
              >
                Settings
              </Link>
              {session.user.isAdmin && (
                <>
                  <Link
                    href="/admin/moderation"
                    onClick={() => setOpen(false)}
                    className="rounded-lg px-3 py-2 text-foreground-soft hover:bg-line"
                  >
                    Moderation
                  </Link>
                  <Link
                    href="/admin/circles"
                    onClick={() => setOpen(false)}
                    className="rounded-lg px-3 py-2 text-foreground-soft hover:bg-line"
                  >
                    Circles (admin)
                  </Link>
                  <Link
                    href="/admin/analytics"
                    onClick={() => setOpen(false)}
                    className="rounded-lg px-3 py-2 text-foreground-soft hover:bg-line"
                  >
                    Analytics
                  </Link>
                  <Link
                    href="/admin/users"
                    onClick={() => setOpen(false)}
                    className="rounded-lg px-3 py-2 text-foreground-soft hover:bg-line"
                  >
                    Users
                  </Link>
                </>
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
                <span className="relative">
                  <Icon size={20} strokeWidth={active ? 2.5 : 2} />
                  {tab.href === "/messages" && unreadMessages > 0 && (
                    <span className="absolute -right-1.5 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-semibold text-white">
                      {unreadMessages > 9 ? "9+" : unreadMessages}
                    </span>
                  )}
                </span>
                {tab.label}
              </Link>
            );
          })}
        </nav>
      )}
    </>
  );
}
