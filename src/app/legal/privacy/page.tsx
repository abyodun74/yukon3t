import type { Metadata } from "next";
import { isViewOnceConfigured } from "@/lib/storage";

const title = "Privacy Policy | YuKon3t";
const description =
  "YuKon3t's Privacy Policy: what we collect, how we use it, your data rights, retention, cookies and security. We never sell your personal data.";

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  openGraph: {
    type: "website",
    url: "/legal/privacy",
    siteName: "YuKon3t",
    title,
    description,
    images: [{ url: "/icons/icon-512.png", width: 512, height: 512 }],
  },
  twitter: {
    card: "summary",
    title,
    description,
    images: ["/icons/icon-512.png"],
  },
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-14 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Privacy Policy</h1>
      <p className="mt-2 text-xs text-foreground-soft">Last updated: October 18, 2026</p>

      <p className="mt-4 text-foreground-soft">
        YuKon3t is operated by Motiff Core Holdings, a Delaware company,
        which is the data controller for the personal information described
        below (&quot;Motiff Core Holdings,&quot; &quot;we,&quot;
        &quot;us&quot;). This Privacy Policy explains what information we
        collect when you use YuKon3t, why we collect it, and the rights you
        have over it. We collect the minimum needed to run a global,
        trust-based social platform, and we never sell your personal data.
      </p>

      <h2 className="mt-8 font-semibold">1. Information we collect</h2>
      <p className="mt-2 text-foreground-soft">We collect:</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground-soft">
        <li><b>Account information</b>: email address, optionally a username and password (stored as a salted hash, never in plain text), date of birth (used only to confirm you meet our minimum age requirement — not shown on your profile), display name, bio, country, languages, interests, and profile picture.</li>
        <li><b>Content you create</b>: Circle and Channel posts, Collab Board listings, direct messages, 24-hour Stories (including reactions and replies to them), reports you file, and any photos or short videos you upload.</li>
        <li><b>Connection &amp; activity data</b>: Circles and Channels you join, connection requests, intent tags you select, streaks, event RSVPs, trust score signals (account age, verification status, report history).</li>
        <li><b>Secret chat keys and messages</b>: if you set up secret chats, we store your public encryption key and a copy of your private key that is encrypted with your recovery passphrase, which we cannot read or reset. The text of messages in a secret chat is encrypted on your device before it is sent; we store only the encrypted form and cannot read it. Photos, videos, and voice notes sent in a secret chat are not encrypted. When you report a message from a secret chat, the text of that message is shared with our moderators.</li>
        <li><b>Notification data</b>: if you enable push notifications, a device push token (a web push subscription, or, on the Android app, a Firebase Cloud Messaging token) used only to deliver notifications like calls, messages, and event reminders to your device. In the mobile apps, the app&apos;s version and build number and your device&apos;s platform (Android or iOS) are stored with that token, used only to tell people on an older version that an app update is available or required.</li>
        <li><b>Call &amp; live session data</b>: metadata needed to connect a 1:1 call or a Collab live session (who&apos;s in the room, timing). If a live session&apos;s host turns on cloud recording, the recording itself is stored as described in Section 4.</li>
        <li><b>Product usage events</b>: a small number of key lifecycle events tied to your account — for example sign-up, sign-in, a post created, a connection requested or accepted, a message sent, a call started, or a circle joined or created — used to keep the service reliable and to understand how features are used.</li>
        <li><b>Technical data</b>: IP address and basic request metadata (used for rate limiting and abuse prevention), session cookies, and your theme preference cookie.</li>
        <li><b>Communications</b>: if you contact us for support or to appeal a moderation decision.</li>
        <li><b>Advertiser information</b>: if you book a paid ad placement, we collect the company name, contact name, and contact email you submit, along with the ad creative (headline, body text, image or video, and destination link).</li>
        <li><b>Device contacts</b>: only if you use the &quot;Invite from contacts&quot; feature — read from your device to show which of your contacts to invite. This list is never uploaded to or stored on our servers; it&apos;s discarded the moment you leave that screen.</li>
      </ul>
      <p className="mt-2 text-foreground-soft">
        We do not require or knowingly collect government ID or precise
        geolocation. Members do not need to provide any payment information
        to use YuKon3t socially — the only payments we process are from
        advertisers booking paid ad placements, handled by Stripe as
        described below. We never see or store your full card number.
      </p>

      <h2 className="mt-8 font-semibold">2. How we use your information</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground-soft">
        <li>To create and operate your account, and to authenticate sign-ins via emailed magic links or, if you choose, a username and password.</li>
        <li>To confirm you meet our minimum age requirement before your account is created.</li>
        <li>To operate core features: Circles, Channels, Collab Boards, Stories, Discover matching, connections, messaging, and voice/video calls and live sessions.</li>
        <li>To let a Circle&apos;s owner invite that Circle&apos;s members to a private collaboration: being a member of a Circle means its owner can send you a collaboration invite even if you aren&apos;t connected, which you can decline.</li>
        <li>To let the organizer or a co-admin of a private collaboration, when they start its live session, notify the collaboration&apos;s participants that the session is live and invite the members of Circles they created (the same collaboration invite described above, which you can decline).</li>
        <li>To let a private Circle&apos;s owner or co-admins invite you to join it: if you&apos;re connected with one of them, they can send you an invite to that Circle, which you can decline.</li>
        <li>To deliver push notifications you&apos;ve enabled, such as incoming calls, new messages, and event reminders.</li>
        <li>To automatically screen text, photos, and video — including ad creative — for policy violations before they are shown to others.</li>
        <li>To investigate reports, enforce our Community Guidelines, and maintain an audit trail of moderation decisions.</li>
        <li>To compute your trust score from account age, verification status, and report history.</li>
        <li>To review, run, and bill paid ad placements, and to display non-targeted ads to users of the service (see Section 5).</li>
        <li>To detect and prevent fraud, spam, and abuse, including rate-limiting requests.</li>
        <li>To log key product-usage events for reliability and to understand feature usage, in aggregate.</li>
        <li>To communicate with you about your account, security, or policy changes.</li>
      </ul>

      <h2 className="mt-8 font-semibold">3. Legal basis for processing (EEA/UK users)</h2>
      <p className="mt-2 text-foreground-soft">
        Where the General Data Protection Regulation (GDPR) applies, we
        process your data under these legal bases: performance of a contract
        (providing the service you sign up for), legitimate interests
        (safety, fraud prevention, moderation), and consent (optional
        features like uploading media, enabling push notifications, or
        joining a call, which you actively choose to use). You can withdraw
        consent at any time by not using that feature, or by deleting your
        account.
      </p>

      <h2 className="mt-8 font-semibold">4. Third-party service providers</h2>
      <p className="mt-2 text-foreground-soft">
        We use a small number of specialized providers to operate YuKon3t.
        Each processes only the data necessary for its function, under its
        own privacy and security terms:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground-soft">
        <li><b>Netlify</b> — application hosting and infrastructure.</li>
        <li><b>Neon</b> — our PostgreSQL database provider, storing account and content data.</li>
        <li><b>Resend</b> — sends sign-in and account-related emails.</li>
        <li><b>Cloudflare (R2)</b> — stores uploaded photos and videos, including Story and ad media.</li>
        <li><b>Cloudflare (Stream)</b> — a temporary copy of an uploaded video may be sent here for automated moderation scanning and caption generation, and QuickTime (.mov) videos are sent here to be converted to a widely playable MP4; the video is still served from R2 above, and the Stream copy is deleted once it is no longer needed.</li>
        <li><b>Cloudflare (Turnstile)</b> — a bot check on sign-up, sign-in, password reset, device verification, phone-verification code requests, and ad booking forms, used to tell real people from automated scripts. When it runs, Cloudflare receives technical signals from your browser and network connection (such as your IP address) and processes them under Cloudflare&apos;s own privacy policy; it runs only when you tap “Verify you&apos;re human”, and Cloudflare may then ask you to complete a short check.</li>
        <li><b>Firebase App Check (Google), with Play Integrity on Android and App Attest (Apple) on iPhone</b> — in the YuKon3t mobile app, on sign-up, sign-in and password reset, the app asks Google&apos;s Firebase App Check for a one-time token showing it is the genuine, unmodified app running on a genuine device. Google, and Apple on iPhone, process app and device integrity signals to produce it, under their own privacy policies, and we verify the token with Google. If it is valid, we may skip the “Verify you&apos;re human” tap; it never replaces that check on the website. We use it only for security and abuse prevention. We store no device identifiers from it, only an anonymous record of the result, platform and app version.</li>
        <li><b>OpenAI</b> — automated content moderation of text and images before publication. We do not send full account profiles to this provider — only the specific content being screened.</li>
        <li><b>Daily.co</b> — powers 1:1 voice/video calls and Collab live sessions. If a live session&apos;s host enables cloud recording, the recording is stored by Daily until the host or an admin deletes it.</li>
        <li><b>Firebase Cloud Messaging (Google)</b> — delivers push notifications to the Android app. Web push notifications are sent directly to your browser&apos;s push service without a third-party intermediary of ours.</li>
        <li><b>Stripe</b> — processes payments from advertisers booking paid ad placements via a hosted Stripe Checkout page. We never receive or store full card numbers.</li>
        <li><b>Sentry</b> — if enabled, receives details about application errors (which may include limited technical context about the request that failed) to help us diagnose bugs.</li>
      </ul>
      <p className="mt-2 text-foreground-soft">
        We do not sell your personal information to anyone, including these
        providers, and we do not permit them to use your data for their own
        marketing purposes.
      </p>
      <p className="mt-2 text-foreground-soft">
        Separately, a post can embed a video hosted on YouTube, Vimeo,
        TikTok, Instagram, Facebook, or Dailymotion instead of an uploaded
        file. Viewing that embedded player loads it directly from that
        platform, which may set its own cookies or collect data under its
        own privacy policy — YuKon3t only stores which video is linked, not
        anything the platform itself collects when you view it.
      </p>

      <h2 className="mt-8 font-semibold">5. Advertising</h2>
      <p className="mt-2 text-foreground-soft">
        YuKon3t sells a small number of paid ad placements to fund the
        service. These are sold at a single flat rate with no audience
        targeting available to advertisers — we do not use your account
        data, activity, or trust score to choose which ad you see, and we do
        not share your personal information with advertisers. We record
        only aggregate, non-personal impression and click counts per ad
        campaign to measure reach and bill fairly; we do not track which
        individual user viewed or clicked a given ad, and we do not use
        third-party advertising or tracking cookies to do so.
      </p>
      <p className="mt-2 text-foreground-soft">
        Every ad is reviewed by a human before it goes live, and the same
        automated content screening described in Section 1 is applied to ad
        creative. If you submit an ad booking, see the &quot;Advertiser
        information&quot; item in Section 1 for what we collect from you.
        Clicking through to an advertiser&apos;s link takes you to a
        third-party site we don&apos;t control — see our{" "}
        <a href="/legal/disclaimer" className="text-accent">Disclaimer</a>.
      </p>

      <h2 className="mt-8 font-semibold">6. International data transfers</h2>
      <p className="mt-2 text-foreground-soft">
        YuKon3t is a global service, and our infrastructure providers operate
        data centers in multiple countries, including the United States.
        If you access YuKon3t from the EEA, UK, or elsewhere outside the
        provider&apos;s home region, your data may be transferred to and
        processed in a country with different data protection laws than
        your own. Our providers maintain appropriate safeguards (such as
        Standard Contractual Clauses) for these transfers where required.
      </p>

      <h2 className="mt-8 font-semibold">7. Data retention</h2>
      <p className="mt-2 text-foreground-soft">
        We retain your account and content data for as long as your account
        is active. If you delete your account, your profile, posts,
        messages, Stories, and Circle/Channel memberships are permanently
        deleted, subject to a short operational delay for backup rotation.
        Moderation records (reports and audit log entries) tied to
        enforcement actions may be retained separately for a limited period
        to maintain platform safety and legal compliance, even after an
        associated account is deleted. Ad campaign records, including
        advertiser contact details and creative, are retained after a
        campaign ends for our accounting and audit purposes. Recordings of
        Collab live sessions are retained by Daily.co until the host or an
        admin deletes them.
      </p>
      {isViewOnceConfigured() && (
        <p className="mt-2 text-foreground-soft">
          <b>View-once photos and videos.</b> A photo or video sent as
          &quot;view once&quot; in a one-to-one chat is stored in private
          storage with no public link. When it is sent, the photo (or, for a
          video, one still frame) is screened automatically like any other
          upload. When the recipient opens it, the file is deleted from our
          storage: normally immediately, and within a few minutes at most if
          their app could not confirm it. If it is never opened, the file is
          deleted 14 days after it was sent, or sooner if the sender deletes
          the message for everyone; if the chat or the sender&apos;s account
          is deleted first, the file can no longer be opened by anyone and is
          removed from storage within 15 days. We do not keep a copy for
          moderation or any other purpose, and the file itself is never
          included in our database backups. We do keep the message record:
          that a view-once photo or video was sent, by whom, when, and whether
          and when it was opened. We cannot prevent the recipient from
          capturing what is on their screen.
        </p>
      )}
      <p className="mt-2 text-foreground-soft">
        <b>Hidden chats.</b> If you hide a chat, we store which chats you
        have hidden and when, and a one-way hash of the PIN you chose (never
        the PIN itself), together with a count of recent wrong PIN attempts.
        This is visible only to your own account; the other people in the
        chat are not told. Hiding changes where a chat is shown to you and
        what its notifications say. It does not change how the messages are
        stored, scanned or retained.
      </p>

      <h2 className="mt-8 font-semibold">8. Your rights</h2>
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
        us using the details in Section 12.
      </p>

      <h2 className="mt-8 font-semibold">9. Children&apos;s privacy</h2>
      <p className="mt-2 text-foreground-soft">
        YuKon3t is not directed to, and is not intended for use by, anyone
        under 16 years old. We do not knowingly collect personal information
        from anyone under 16. If we learn that we have collected information
        from someone under 16, we will delete it and close the associated
        account promptly.
      </p>

      <h2 className="mt-8 font-semibold">10. Cookies</h2>
      <p className="mt-2 text-foreground-soft">
        We use a session cookie to keep you signed in and a small,
        non-sensitive cookie to remember your light/dark/system theme
        preference. We do not use third-party advertising or tracking
        cookies on YuKon3t. If you complete a paid ad booking, Stripe&apos;s
        hosted checkout page (on stripe.com, outside YuKon3t) may set its own
        cookies under Stripe&apos;s own privacy policy.
      </p>

      <h2 className="mt-8 font-semibold">11. Data security</h2>
      <p className="mt-2 text-foreground-soft">
        We use industry-standard technical safeguards, including encrypted
        connections (HTTPS/TLS) everywhere, encrypted secrets management,
        rate limiting, and per-request access controls that verify every
        action server-side. Voice/video calls and live sessions are relayed
        through our video provider using encrypted connections. If you set a
        password, we never store it in plain text — only a salted bcrypt
        hash, which we cannot reverse to see your actual password. No method
        of transmission or storage is 100% secure, and we cannot guarantee
        absolute security. If we become aware of a data breach affecting
        your personal information, we will notify affected users and
        relevant authorities as required by applicable law.
      </p>

      <h2 className="mt-8 font-semibold">12. Contact us</h2>
      <p className="mt-2 text-foreground-soft">
        Questions about this policy, or requests to exercise your data
        rights, can be sent to the email address associated with your
        account&apos;s support channel, or by replying to any account
        notification email. We aim to respond within 30 days.
      </p>

      <h2 className="mt-8 font-semibold">13. Changes to this policy</h2>
      <p className="mt-2 text-foreground-soft">
        We may update this Privacy Policy as YuKon3t evolves. Material
        changes will be announced in-app or by email before they take
        effect. Continued use of YuKon3t after a change takes effect
        constitutes acceptance of the updated policy.
      </p>
    </div>
  );
}
