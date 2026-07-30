export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-14 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Privacy Policy</h1>
      <p className="mt-2 text-xs text-foreground-soft">Last updated: July 30, 2026</p>

      <p className="mt-4 text-foreground-soft">
        This Privacy Policy explains what information YuKon3t (&quot;YuKon3t,&quot;
        &quot;we,&quot; &quot;us&quot;) collects when you use the service, why we
        collect it, and the rights you have over it. We collect the minimum
        needed to run a global, trust-based social platform, and we never
        sell your personal data.
      </p>

      <h2 className="mt-8 font-semibold">1. Information we collect</h2>
      <p className="mt-2 text-foreground-soft">We collect:</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground-soft">
        <li><b>Account information</b>: email address, display name, bio, country, languages, interests, and profile picture.</li>
        <li><b>Content you create</b>: Circle posts, Collab Board listings, direct messages, reports you file, and any photos or short videos you upload.</li>
        <li><b>Connection &amp; activity data</b>: Circles you join, connection requests, intent tags you select, trust score signals (account age, verification status, report history).</li>
        <li><b>Technical data</b>: IP address and basic request metadata (used for rate limiting and abuse prevention), session cookies, and your theme preference cookie.</li>
        <li><b>Communications</b>: if you contact us for support or to appeal a moderation decision.</li>
      </ul>
      <p className="mt-2 text-foreground-soft">
        We do not require or knowingly collect government ID, precise
        geolocation, or payment card data — YuKon3t does not currently
        process payments.
      </p>

      <h2 className="mt-8 font-semibold">2. How we use your information</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground-soft">
        <li>To create and operate your account, and to authenticate sign-ins via emailed magic links.</li>
        <li>To operate core features: Circles, Collab Boards, Discover matching, connections, and messaging.</li>
        <li>To automatically screen text, photos, and video for policy violations before they are shown to others.</li>
        <li>To investigate reports, enforce our Community Guidelines, and maintain an audit trail of moderation decisions.</li>
        <li>To compute your trust score from account age, verification status, and report history.</li>
        <li>To detect and prevent fraud, spam, and abuse, including rate-limiting requests.</li>
        <li>To communicate with you about your account, security, or policy changes.</li>
      </ul>

      <h2 className="mt-8 font-semibold">3. Legal basis for processing (EEA/UK users)</h2>
      <p className="mt-2 text-foreground-soft">
        Where the General Data Protection Regulation (GDPR) applies, we
        process your data under these legal bases: performance of a contract
        (providing the service you sign up for), legitimate interests
        (safety, fraud prevention, moderation), and consent (optional
        features like uploading media, which you actively choose to use).
        You can withdraw consent at any time by not using that feature, or
        by deleting your account.
      </p>

      <h2 className="mt-8 font-semibold">4. Third-party service providers</h2>
      <p className="mt-2 text-foreground-soft">
        We use a small number of specialized providers to operate YuKon3t.
        Each processes only the data necessary for its function, under its
        own privacy and security terms:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground-soft">
        <li><b>Vercel</b> — application hosting and infrastructure.</li>
        <li><b>Neon</b> — our PostgreSQL database provider, storing account and content data.</li>
        <li><b>Resend</b> — sends sign-in and account-related emails.</li>
        <li><b>Cloudflare (R2)</b> — stores uploaded photos and videos.</li>
        <li><b>OpenAI</b> — automated content moderation of text and images before publication. We do not send full account profiles to this provider — only the specific content being screened.</li>
      </ul>
      <p className="mt-2 text-foreground-soft">
        We do not sell your personal information to anyone, including these
        providers, and we do not permit them to use your data for their own
        marketing purposes.
      </p>

      <h2 className="mt-8 font-semibold">5. International data transfers</h2>
      <p className="mt-2 text-foreground-soft">
        YuKon3t is a global service, and our infrastructure providers operate
        data centers in multiple countries, including the United States.
        If you access YuKon3t from the EEA, UK, or elsewhere outside the
        provider&apos;s home region, your data may be transferred to and
        processed in a country with different data protection laws than
        your own. Our providers maintain appropriate safeguards (such as
        Standard Contractual Clauses) for these transfers where required.
      </p>

      <h2 className="mt-8 font-semibold">6. Data retention</h2>
      <p className="mt-2 text-foreground-soft">
        We retain your account and content data for as long as your account
        is active. If you delete your account, your profile, posts,
        messages, and Circle memberships are permanently deleted, subject to
        a short operational delay for backup rotation. Moderation records
        (reports and audit log entries) tied to enforcement actions may be
        retained separately for a limited period to maintain platform
        safety and legal compliance, even after an associated account is
        deleted.
      </p>

      <h2 className="mt-8 font-semibold">7. Your rights</h2>
      <p className="mt-2 text-foreground-soft">
        Regardless of where you live, you can access, export, correct, or
        permanently delete your data at any time from{" "}
        <a href="/settings" className="text-accent">Settings</a> — for free,
        with no limit, and without needing to contact us. Depending on your
        location, you may also have the right to:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground-soft">
        <li><b>EEA/UK (GDPR)</b>: access, rectification, erasure, restriction of processing, data portability, and objection to processing based on legitimate interest.</li>
        <li><b>California (CCPA/CPRA)</b>: the right to know what personal information we collect, the right to delete it, and the right to opt out of its sale — we do not sell personal information, so there is nothing to opt out of. We do not discriminate against users who exercise these rights.</li>
        <li><b>Other jurisdictions</b>: many countries have similar data protection frameworks; we honor equivalent requests on a good-faith basis regardless of where you&apos;re located.</li>
      </ul>
      <p className="mt-2 text-foreground-soft">
        To exercise a right that isn&apos;t self-service in Settings, contact
        us using the details in Section 11.
      </p>

      <h2 className="mt-8 font-semibold">8. Children&apos;s privacy</h2>
      <p className="mt-2 text-foreground-soft">
        YuKon3t is not directed to, and is not intended for use by, anyone
        under 18 years old. We do not knowingly collect personal information
        from children. If we learn that we have collected information from
        someone under 18, we will delete it and terminate the associated
        account promptly.
      </p>

      <h2 className="mt-8 font-semibold">9. Cookies</h2>
      <p className="mt-2 text-foreground-soft">
        We use a session cookie to keep you signed in and a small,
        non-sensitive cookie to remember your light/dark/system theme
        preference. We do not use third-party advertising or tracking
        cookies.
      </p>

      <h2 className="mt-8 font-semibold">10. Data security</h2>
      <p className="mt-2 text-foreground-soft">
        We use industry-standard technical safeguards, including encrypted
        connections (HTTPS/TLS) everywhere, encrypted secrets management,
        rate limiting, and per-request access controls that verify every
        action server-side. No method of transmission or storage is 100%
        secure, and we cannot guarantee absolute security. If we become
        aware of a data breach affecting your personal information, we will
        notify affected users and relevant authorities as required by
        applicable law.
      </p>

      <h2 className="mt-8 font-semibold">11. Contact us</h2>
      <p className="mt-2 text-foreground-soft">
        Questions about this policy, or requests to exercise your data
        rights, can be sent to the email address associated with your
        account&apos;s support channel, or by replying to any account
        notification email. We aim to respond within 30 days.
      </p>

      <h2 className="mt-8 font-semibold">12. Changes to this policy</h2>
      <p className="mt-2 text-foreground-soft">
        We may update this Privacy Policy as YuKon3t evolves. Material
        changes will be announced in-app or by email before they take
        effect. Continued use of YuKon3t after a change takes effect
        constitutes acceptance of the updated policy.
      </p>
    </div>
  );
}
