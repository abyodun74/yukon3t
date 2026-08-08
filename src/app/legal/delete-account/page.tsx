import Link from "next/link";

export default function DeleteAccountPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-14 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Delete Your Account</h1>
      <p className="mt-2 text-xs text-foreground-soft">Last updated: August 8, 2026</p>

      <p className="mt-4 text-foreground-soft">
        You can permanently delete your YuKon3t account and all associated
        data at any time, for free, with no waiting period and no need to
        contact support.
      </p>

      <h2 className="mt-8 font-semibold">How to delete your account</h2>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-foreground-soft">
        <li>Sign in to YuKon3t at <a href="/sign-in" className="text-accent">yukon3t.com</a> (or open the Android app).</li>
        <li>Go to <Link href="/settings" className="text-accent">Settings</Link>.</li>
        <li>Scroll to the &quot;Delete account&quot; section and confirm.</li>
      </ol>
      <p className="mt-2 text-foreground-soft">
        Deletion happens immediately when you confirm — there is no grace
        period, and we do not require you to explain why or fill out a form.
      </p>

      <h2 className="mt-8 font-semibold">What gets deleted</h2>
      <p className="mt-2 text-foreground-soft">
        Deleting your account permanently removes your profile, posts,
        messages, Stories, Circle and Channel memberships, connections, and
        all other content and data tied to your account. This is a hard
        delete, not a deactivation.
      </p>
      <p className="mt-2 text-foreground-soft">
        A small amount of data may be retained separately from your account
        for a limited period where required for moderation records, legal
        compliance, or accounting (for example, audit log entries tied to a
        past enforcement action, or advertiser billing records) — see
        Section 7 (&quot;Data retention&quot;) of our{" "}
        <Link href="/legal/privacy" className="text-accent">Privacy Policy</Link>{" "}
        for the specifics.
      </p>

      <h2 className="mt-8 font-semibold">Can&apos;t sign in?</h2>
      <p className="mt-2 text-foreground-soft">
        If you&apos;re unable to sign in to request deletion yourself,
        contact us using the details in Section 12 of our{" "}
        <Link href="/legal/privacy" className="text-accent">Privacy Policy</Link>{" "}
        and we will process the request manually once we&apos;ve verified you
        control the account.
      </p>
    </div>
  );
}
