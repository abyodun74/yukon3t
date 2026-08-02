export default function GuidelinesPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-14 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Community Guidelines</h1>
      <p className="mt-2 text-xs text-foreground-soft">Last updated: August 2, 2026</p>
      <p className="mt-4 text-foreground-soft">
        YuKon3t exists to connect people honestly across borders, cultures,
        and interests. These rules are enforced consistently, and every
        enforcement action comes with a stated reason. Violating these
        Guidelines is also a violation of our{" "}
        <a href="/legal/terms" className="text-accent">Terms of Service</a>.
      </p>

      <h2 className="mt-8 font-semibold">1. Be who you say you are</h2>
      <p className="mt-2 text-foreground-soft">
        No fake profiles, impersonation, or catfishing. Accounts must verify
        their email before messaging unlocks.
      </p>

      <h2 className="mt-8 font-semibold">2. Respect stated intent</h2>
      <p className="mt-2 text-foreground-soft">
        Every member tags what they&apos;re open to — friendship, cultural
        exchange, professional, community, or travel tips. Pushing a
        conversation toward an intent the other person hasn&apos;t opted
        into is a violation.
      </p>

      <h2 className="mt-8 font-semibold">3. No harassment, hate, or scams</h2>
      <p className="mt-2 text-foreground-soft">
        Harassment, hate speech, solicitation, and financial scams result in
        immediate suspension. This includes requests for money, gift cards,
        or financial account access from anyone you&apos;ve connected with
        on YuKon3t — we will never ask you for money, and neither should
        another member.
      </p>

      <h2 className="mt-8 font-semibold">4. Photos and videos: strict, zero-tolerance policy</h2>
      <p className="mt-2 text-foreground-soft">
        No sexually explicit or sexually suggestive photos or videos,
        anywhere on YuKon3t — profile pictures, Circle posts, or your
        personal feed. Every upload is automatically screened before
        it&apos;s visible to anyone else; violating uploads are rejected and
        never published. Posting this kind of content results in an
        immediate, permanent ban. Linked videos are subject to our content
        policy even though they&apos;re hosted elsewhere — posting a YouTube
        or Vimeo link is held to the same standard as uploading the video
        yourself.
      </p>

      <h2 className="mt-8 font-semibold">5. Respect intellectual property</h2>
      <p className="mt-2 text-foreground-soft">
        Only post content you have the right to share. Don&apos;t upload
        copyrighted photos, video, or writing that isn&apos;t yours without
        permission. See our{" "}
        <a href="/legal/terms" className="text-accent">Terms of Service</a>{" "}
        for how to file or respond to a copyright claim.
      </p>

      <h2 className="mt-8 font-semibold">6. Meeting in person and travel safety</h2>
      <p className="mt-2 text-foreground-soft">
        YuKon3t helps you find people for cross-country collaboration,
        travel tips, and real-world meetups through Circles and Collab
        Boards — but we cannot verify anyone&apos;s real-world identity or
        intentions beyond email verification and community trust signals.
        If you choose to meet someone in person or travel to meet them:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground-soft">
        <li>Meet in a public place first, and tell a friend or family member your plans.</li>
        <li>Never send money, deposits, or financial information to someone you met on YuKon3t.</li>
        <li>Trust badges reflect account signals (verification, tenure, report history) — they are not a background check or a safety guarantee.</li>
        <li>Report anyone who pressures you to move off-platform quickly or asks for financial help.</li>
      </ul>
      <p className="mt-2 text-foreground-soft">
        See our{" "}
        <a href="/legal/disclaimer" className="text-accent">Disclaimer</a>{" "}
        for more on the limits of what YuKon3t can guarantee about other
        members.
      </p>

      <h2 className="mt-8 font-semibold">7. How moderation works</h2>
      <p className="mt-2 text-foreground-soft">
        Reports are triaged within 24 hours. Every action against your
        account (warning, suspension, or ban) states the specific reason and
        is recorded in your account history. A suspension is temporary; a
        ban is permanent. You can appeal by replying to the notification
        email — moderation decisions are never sealed from you.
      </p>
    </div>
  );
}
