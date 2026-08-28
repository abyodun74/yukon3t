import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Circular avatar — a person's photo if they have one, otherwise their
 * initial. `online` draws a small dot over the corner (see src/lib/presence.ts
 * for what counts as online) — the avatar circle itself keeps every class/
 * style existing callers already pass via `className`, on a plain wrapping
 * `span` so the dot can sit outside its `overflow-hidden` clip.
 */
export function UserAvatar({
  avatarUrl,
  name,
  size = 24,
  className,
  online,
}: {
  avatarUrl?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
  online?: boolean;
}) {
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <div
        className={cn("h-full w-full overflow-hidden rounded-full border border-line bg-surface", className)}
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
      {online && (
        <span
          className="absolute bottom-0 right-0 rounded-full border-2 border-background bg-success"
          style={{ width: Math.max(8, Math.round(size * 0.32)), height: Math.max(8, Math.round(size * 0.32)) }}
          role="img"
          aria-label="Online"
          title="Online"
        />
      )}
    </span>
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
  online,
}: {
  userId: string;
  name: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  avatarSize?: number;
  showUsername?: boolean;
  className?: string;
  online?: boolean;
}) {
  return (
    <Link href={`/u/${userId}`} className={cn("inline-flex min-w-0 items-center gap-2 hover:text-accent", className)}>
      <UserAvatar avatarUrl={avatarUrl} name={name} size={avatarSize} online={online} />
      <span className="min-w-0 truncate">
        <span className="font-medium">{name ?? "Unknown"}</span>
        {showUsername && username && <span className="ml-1 text-foreground-soft">@{username}</span>}
      </span>
    </Link>
  );
}
