import Link from "next/link";
import type { Session } from "next-auth";
import { signOut } from "@/lib/auth";
import { ThemeToggle } from "@/components/theme-toggle";
import type { Theme } from "@/lib/theme";

const links = [
  { href: "/discover", label: "Discover" },
  { href: "/circles", label: "Circles" },
  { href: "/collab", label: "Collab Boards" },
  { href: "/connections", label: "Connections" },
  { href: "/messages", label: "Messages" },
];

export function Nav({ session, theme }: { session: Session | null; theme: Theme }) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight text-accent">
          YuKon3t
        </Link>
        {session?.user && (
          <nav className="hidden gap-5 text-sm font-medium text-foreground-soft md:flex">
            {links.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-accent">
                {link.label}
              </Link>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-3">
          <ThemeToggle initial={theme} />
          {session?.user ? (
            <>
              <Link
                href="/settings"
                className="text-sm text-foreground-soft hover:text-accent"
              >
                Settings
              </Link>
              {session.user.isAdmin && (
                <Link
                  href="/admin/moderation"
                  className="text-sm text-foreground-soft hover:text-accent"
                >
                  Moderation
                </Link>
              )}
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <button
                  type="submit"
                  className="rounded-full border border-line px-3 py-1.5 text-sm hover:border-accent hover:text-accent"
                >
                  Sign out
                </button>
              </form>
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
    </header>
  );
}
