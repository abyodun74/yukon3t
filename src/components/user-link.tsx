import Link from "next/link";
import { cn } from "@/lib/utils";

/** Circular avatar — a person's photo if they have one, otherwise their initial. */
export function UserAvatar({
  avatarUrl,
  name,
  size = 24,
  className,
}: {
  avatarUrl?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("shrink-0 overflow-hidden rounded-full border border-line bg-surface", className)}
      style={{ width: size, height: size }}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-foreground-soft"
          style={{ fontSize: Math.max(9, Math.round(size * 0.4)) }}
        >
          {(name ?? "?").charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  );
}

/**
 * Avatar + display name (+ @username, if set) linked through to a profile
 * — the standard way any user reference should render anywhere in the app
 * (chat, connections, comments, member lists, etc.), so every surface is
 * consistent and clicking through to a profile always works the same way.
 */
export function UserLink({
  userId,
  name,
  username,
  avatarUrl,
  avatarSize = 24,
  showUsername = true,
  className,
}: {
  userId: string;
  name: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  avatarSize?: number;
  showUsername?: boolean;
  className?: string;
}) {
  return (
    <Link href={`/u/${userId}`} className={cn("inline-flex min-w-0 items-center gap-2 hover:text-accent", className)}>
      <UserAvatar avatarUrl={avatarUrl} name={name} size={avatarSize} />
      <span className="min-w-0 truncate">
        <span className="font-medium">{name ?? "Unknown"}</span>
        {showUsername && username && <span className="ml-1 text-foreground-soft">@{username}</span>}
      </span>
    </Link>
  );
}
