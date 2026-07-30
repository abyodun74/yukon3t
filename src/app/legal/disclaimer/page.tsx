export default function DisclaimerPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-14 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Disclaimer</h1>
      <p className="mt-2 text-xs text-foreground-soft">Last updated: July 30, 2026</p>
      <p className="mt-4 text-foreground-soft">
        This page summarizes important limitations on what YuKon3t can
        promise you. It supplements, and should be read together with, our{" "}
        <a href="/legal/terms" className="text-accent">Terms of Service</a>{" "}
        and{" "}
        <a href="/legal/guidelines" className="text-accent">Community Guidelines</a>.
      </p>

      <h2 className="mt-8 font-semibold">No guarantee about other users</h2>
      <p className="mt-2 text-foreground-soft">
        We verify that an account controls the email address it signed up
        with, and we compute a trust score from account age, verification
        status, and report history. We do not perform government ID checks,
        background checks, or in-person identity verification. A
        &quot;Trusted&quot; or &quot;Established&quot; badge is a signal, not
        a certification — use your own judgment, especially before sharing
        personal information, meeting in person, or traveling to meet
        someone you connected with on YuKon3t.
      </p>

      <h2 className="mt-8 font-semibold">User-generated content</h2>
      <p className="mt-2 text-foreground-soft">
        Posts, messages, Circle content, and Collab Board listings are
        created by other members, not by YuKon3t. We automatically screen
        text and media for policy violations before publication, but
        automated moderation is not perfect and does not review every
        message in real time (see Section 5 of our{" "}
        <a href="/legal/terms" className="text-accent">Terms</a>). We do not
        endorse, verify, or take responsibility for the accuracy of any
        user-generated content, including travel tips, recommendations, or
        advice shared through Circles or Collab Boards.
      </p>

      <h2 className="mt-8 font-semibold">Not professional advice</h2>
      <p className="mt-2 text-foreground-soft">
        Nothing on YuKon3t — including content shared in Circles, Collab
        Boards, or direct messages — constitutes legal, financial, medical,
        immigration, or travel-safety advice. Always verify important
        information (visa requirements, local laws, safety conditions)
        through official or professional sources before relying on it.
      </p>

      <h2 className="mt-8 font-semibold">Third-party services and links</h2>
      <p className="mt-2 text-foreground-soft">
        YuKon3t may contain links to third-party websites or reference
        third-party services we don&apos;t control. We are not responsible
        for the content, accuracy, or practices of any third party,
        including any site or service you access as a result of a
        connection made through YuKon3t.
      </p>

      <h2 className="mt-8 font-semibold">Service availability</h2>
      <p className="mt-2 text-foreground-soft">
        YuKon3t is provided on an &quot;as is&quot; and &quot;as
        available&quot; basis. We do not guarantee uninterrupted access, and
        features may change, be temporarily unavailable, or be discontinued
        as the product evolves.
      </p>

      <h2 className="mt-8 font-semibold">Limitation of liability</h2>
      <p className="mt-2 text-foreground-soft">
        To the fullest extent permitted by law, YuKon3t is not liable for
        any harm, loss, or damages arising from your interactions with other
        users, reliance on user-generated content, or any in-person meeting
        or travel arranged as a result of using YuKon3t. Full terms are set
        out in Section 10 of our{" "}
        <a href="/legal/terms" className="text-accent">Terms of Service</a>.
      </p>

      <h2 className="mt-8 font-semibold">Questions</h2>
      <p className="mt-2 text-foreground-soft">
        If anything here is unclear, contact us using the details in our{" "}
        <a href="/legal/privacy" className="text-accent">Privacy Policy</a>.
      </p>
    </div>
  );
}
