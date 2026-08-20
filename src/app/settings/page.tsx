import Link from "next/link";
import { getSessionUserOrRedirect } from "@/lib/page-guards";
import { updatePrivacy, updateRingtone, setPassword } from "@/app/actions/profile";
import { listBlockedUsers } from "@/app/actions/blocks";
import { AccountDangerZone } from "@/components/account-danger-zone";
import { BlockButton } from "@/components/block-button";
import { PasswordInput } from "@/components/password-input";
import { RingtonePicker } from "@/components/ringtone-picker";
import { InviteContactsButton } from "@/components/invite-contacts-button";
import { PushNotificationsToggle } from "@/components/push-notifications-toggle";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const user = await getSessionUserOrRedirect();
  const { error, saved } = await searchParams;
  const blocked = await listBlockedUsers();

  return (
    <div className="mx-auto max-w-xl space-y-10 px-4 py-10">
      <div>
        <h1 className="font-display text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-foreground-soft">
          Signed in as {user.email}
        </p>
        <p className="mt-2 text-sm text-foreground-soft">
          Want to change your name, bio, photo, or interests?{" "}
          <Link href={`/u/${user.id}`} className="text-accent hover:underline">
            Edit your profile
          </Link>
          . New to YuKon3t or looking for how something works?{" "}
          <Link href="/faq" className="text-accent hover:underline">
            Check the FAQ
          </Link>
          .
        </p>
      </div>

      {saved && (
        <p className="rounded-lg bg-success/10 px-4 py-2 text-sm text-success">
          Settings updated.
        </p>
      )}
      {error && (
        <p className="rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          {error === "username_taken"
            ? "That username is taken — try another."
            : error === "current_password_invalid"
              ? "Current password is incorrect."
              : error === "rate_limited"
                ? "Too many attempts — try again in a few minutes."
                : "Please check your inputs."}
        </p>
      )}

      <div>
        <h2 className="text-lg font-semibold">Privacy</h2>
        <p className="mt-1 text-sm text-foreground-soft">
          Controls what people who aren&apos;t connected to you can see.
        </p>
        <form action={updatePrivacy} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium">Who can see your posts</label>
            <select
              name="postsVisibility"
              defaultValue={user.postsVisibility}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
            >
              <option value="PUBLIC">Anyone signed in</option>
              <option value="CONNECTIONS_ONLY">Only my connections</option>
              {user.isAdmin && (
                <option value="HIDDEN">Invisible to everyone (admin only)</option>
              )}
            </select>
          </div>
          <label className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
            <input
              type="checkbox"
              name="discoverable"
              defaultChecked={user.discoverable}
            />
            Show my profile in Discover
          </label>
          <button
            type="submit"
            className="w-full rounded-lg border border-line px-4 py-3 text-sm font-semibold hover:border-accent hover:text-accent"
          >
            Save privacy settings
          </button>
        </form>
      </div>

      <div>
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="mt-1 text-sm text-foreground-soft">
          Get notified about incoming calls and new messages even when
          YuKon3t isn&apos;t open in a tab.
        </p>
        <div className="mt-4">
          <PushNotificationsToggle />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold">Invite friends</h2>
        <p className="mt-1 text-sm text-foreground-soft">
          Send the app link straight to people in your phone&apos;s contacts
          who aren&apos;t on YuKon3t yet.
        </p>
        <div className="mt-4">
          <InviteContactsButton />
        </div>
      </div>

      {blocked.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold">Blocked accounts</h2>
          <p className="mt-1 text-sm text-foreground-soft">
            They can&apos;t message, call, or connect with you, and you won&apos;t see them in Discover.
          </p>
          <ul className="mt-4 space-y-2">
            {blocked.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm"
              >
                <Link href={`/u/${b.blocked.id}`} className="hover:text-accent">
                  {b.blocked.name ?? "Deleted account"}
                </Link>
                <BlockButton
                  targetId={b.blocked.id}
                  targetName={b.blocked.name ?? "them"}
                  initiallyBlocked
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold">Calls</h2>
        <p className="mt-1 text-sm text-foreground-soft">
          Plays for both audio and video calls.
        </p>
        <form action={updateRingtone} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium">Ringtone</label>
            <div className="mt-1">
              <RingtonePicker defaultValue={user.ringtone} />
            </div>
          </div>
          <button
            type="submit"
            className="w-full rounded-lg border border-line px-4 py-3 text-sm font-semibold hover:border-accent hover:text-accent"
          >
            Save ringtone
          </button>
        </form>
      </div>

      <div>
        <h2 className="text-lg font-semibold">Sign-in method</h2>
        <p className="mt-1 text-sm text-foreground-soft">
          {user.passwordHash
            ? "You can sign in with your username and password, or the email link."
            : "Add a username and password as an alternative to the email sign-in link."}
        </p>
        <form action={setPassword} className="mt-4 space-y-4">
          {!user.username && (
            <div>
              <label className="block text-sm font-medium">Username</label>
              <input
                name="username"
                required
                minLength={3}
                maxLength={20}
                pattern="[a-zA-Z0-9_]+"
                className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
              />
            </div>
          )}
          {user.username && (
            <p className="text-sm">
              Username: <span className="font-medium">{user.username}</span>
            </p>
          )}
          {user.passwordHash && (
            <div>
              <label className="block text-sm font-medium">Current password</label>
              <PasswordInput
                name="currentPassword"
                required
                maxLength={72}
                className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium">
              {user.passwordHash ? "New password" : "Password"}
            </label>
            <PasswordInput
              name="password"
              required
              minLength={8}
              maxLength={72}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
            />
          </div>
          {user.passwordHash && (
            <p className="text-xs text-foreground-soft">
              Changing your password signs you out everywhere else.
            </p>
          )}
          <button
            type="submit"
            className="w-full rounded-lg border border-line px-4 py-3 text-sm font-semibold hover:border-accent hover:text-accent"
          >
            {user.passwordHash ? "Update password" : "Set password"}
          </button>
        </form>
      </div>

      <AccountDangerZone />
    </div>
  );
}
