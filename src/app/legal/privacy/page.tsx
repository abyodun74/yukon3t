export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-14 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Privacy Policy</h1>
      <p className="mt-4 text-foreground-soft">
        We collect the minimum needed to run YuKon3t: your email, the
        profile details you choose to add, and content you post. We never
        sell your data.
      </p>
      <h2 className="mt-8 font-semibold">Your data is always yours</h2>
      <p className="mt-2 text-foreground-soft">
        Export a full copy of your data at any time from Settings, free,
        with no limit. Delete your account permanently, also free, also with
        no limit — we never paywall access to your own account or data.
      </p>
      <h2 className="mt-8 font-semibold">What we store</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground-soft">
        <li>Account: email, name, bio, country, languages, interests</li>
        <li>Activity: posts, Circle memberships, Collab Board posts, messages</li>
        <li>Trust &amp; safety: reports you file or receive, moderation actions</li>
      </ul>
      <h2 className="mt-8 font-semibold">Content moderation</h2>
      <p className="mt-2 text-foreground-soft">
        Posts, bios, and messages are automatically prescreened for policy
        violations before publishing. Flagged content is queued for human
        review.
      </p>
    </div>
  );
}
