import type { Metadata } from "next";

const title = "Terms of Service | YuKon3t";
const description =
  "YuKon3t's Terms of Service: eligibility, acceptable use, your content, moderation, calls, ad bookings, termination and how disputes are resolved.";

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  openGraph: {
    type: "website",
    url: "/legal/terms",
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

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-14 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Terms of Service</h1>
      <p className="mt-2 text-xs text-foreground-soft">Last updated: September 29, 2026</p>

      <p className="mt-4 text-foreground-soft">
        YuKon3t is operated by Motiff Core Holdings, a Delaware company
        (&quot;Motiff Core Holdings,&quot; &quot;we,&quot; &quot;us,&quot;
        or &quot;our&quot;). These Terms of Service (&quot;Terms&quot;)
        govern your access to and use of YuKon3t. By creating an account or
        otherwise using YuKon3t, you agree to these Terms, our{" "}
        <a href="/legal/privacy" className="text-accent">Privacy Policy</a>,
        our{" "}
        <a href="/legal/guidelines" className="text-accent">Community Guidelines</a>,
        and our{" "}
        <a href="/legal/disclaimer" className="text-accent">Disclaimer</a>.
        If you do not agree, do not use YuKon3t.
      </p>

      <h2 className="mt-8 font-semibold">1. Eligibility</h2>
      <p className="mt-2 text-foreground-soft">
        You must be at least 13 years old to use YuKon3t; if you are under
        18, you may only use YuKon3t with the involvement and consent of a
        parent or legal guardian. By creating an account, you represent that
        you meet this requirement, that your date of birth and all other
        information you provide is accurate, and that you are not barred
        from using YuKon3t under the laws of your country or any applicable
        export control or sanctions list.
      </p>

      <h2 className="mt-8 font-semibold">2. Your account</h2>
      <p className="mt-2 text-foreground-soft">
        You can sign in either via an emailed one-time link, or with a
        username and password you set at sign-up. If you use a password,
        you are responsible for keeping it secret and for all activity that
        occurs under your account. Notify us immediately if you believe
        your account has been compromised.
      </p>

      <h2 className="mt-8 font-semibold">3. Acceptable use</h2>
      <p className="mt-2 text-foreground-soft">
        You agree to use YuKon3t in accordance with our{" "}
        <a href="/legal/guidelines" className="text-accent">Community Guidelines</a>,
        which are incorporated into these Terms by reference. Violations may
        result in content removal, a warning, a temporary suspension, or a
        permanent ban, each with a stated reason and an appeal path, as
        described in the Guidelines.
      </p>

      <h2 className="mt-8 font-semibold">4. Your content</h2>
      <p className="mt-2 text-foreground-soft">
        You retain ownership of the text, photos, and videos you post
        (&quot;User Content&quot;), including Circle, Channel, and Collab
        Board posts and Stories. By posting User Content, you grant
        YuKon3t a worldwide, non-exclusive, royalty-free license to host,
        store, reproduce, and display that content solely for the purpose of
        operating and providing the service to you and other users — for
        example, showing your posts to Circle members or your Story to your
        connections. This license ends when you delete the content or your
        account, except for content already shared with others in ways it
        can&apos;t practically be recalled (e.g., a message already read by
        its recipient), and except where retention is required for
        moderation records as described in our Privacy Policy.
      </p>
      <p className="mt-2 text-foreground-soft">
        You are solely responsible for your User Content and confirm you
        have the necessary rights to post it. Automated content moderation
        (see Section 5) reduces but does not eliminate the risk of
        encountering objectionable content from other users; YuKon3t does
        not pre-screen all content and does not endorse any User Content.
      </p>

      <h2 className="mt-8 font-semibold">5. Content moderation and enforcement</h2>
      <p className="mt-2 text-foreground-soft">
        We use a combination of automated screening and human review to
        enforce our Community Guidelines. We reserve the right, but do not
        assume the obligation, to review, remove, or restrict any content or
        account at our discretion, including content that hasn&apos;t been
        reported, if we believe it violates these Terms or our Guidelines or
        creates risk for our users or YuKon3t.
      </p>
      <p className="mt-2 text-foreground-soft">
        <b>Secret chats.</b> The text of a secret chat (a one-to-one
        conversation both people opt into) is end-to-end encrypted, so we
        cannot read or scan it. These Terms and our Guidelines still apply to
        it. We rely on reports from participants — which include the text of
        the reported message — to enforce them there. Photos, videos, and
        voice notes in a secret chat are not encrypted and are screened like
        any other content.
      </p>

      <h2 className="mt-8 font-semibold">6. Intellectual property &amp; copyright (DMCA)</h2>
      <p className="mt-2 text-foreground-soft">
        The YuKon3t name, logo, and underlying software are owned by
        YuKon3t and its licensors. If you believe content on YuKon3t
        infringes your copyright, send a takedown notice to our support
        contact including: (a) identification of the copyrighted work, (b)
        the URL or location of the allegedly infringing content, (c) your
        contact information, and (d) a statement that you have a good-faith
        belief the use is unauthorized, made under penalty of perjury. We
        will remove content that we determine, in good faith, to be
        infringing, and may terminate accounts of repeat infringers.
      </p>

      <h2 className="mt-8 font-semibold">7. Third-party services and links</h2>
      <p className="mt-2 text-foreground-soft">
        YuKon3t relies on third-party infrastructure providers described in
        our Privacy Policy — including Stripe for ad payments, Daily.co for
        calls and live sessions, and Firebase Cloud Messaging for Android
        push notifications — and users may post links to external websites
        or services. We do not control and are not responsible for
        third-party content, websites, or services, including anything you
        access as a result of a connection made through YuKon3t or a link in
        an ad.
      </p>

      <h2 className="mt-8 font-semibold">8. Voice/video calls and live sessions</h2>
      <p className="mt-2 text-foreground-soft">
        YuKon3t offers 1:1 voice/video calls between connected users and
        group live sessions on Collabs, powered by our video infrastructure
        provider. A live session&apos;s host may enable cloud recording of
        that session, which our video provider&apos;s call interface
        indicates while active; the resulting recording is stored as
        described in our Privacy Policy until the host or an admin deletes
        it. Do not record or rebroadcast a call or live session outside of
        this built-in feature without the consent of everyone participating,
        and you are responsible for complying with any recording-consent
        laws that apply to you and other participants.
      </p>

      <h2 className="mt-8 font-semibold">9. Advertising and paid placements</h2>
      <p className="mt-2 text-foreground-soft">
        YuKon3t sells flat-rate, untargeted ad placements shown to users of
        the service. If you submit an ad booking (an &quot;Advertiser&quot;),
        the following additional terms apply:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground-soft">
        <li>You represent that you have the right to use the company name, contact details, and creative (images, video, and text) you submit, and that the ad and its linked destination comply with applicable law and don&apos;t infringe any third party&apos;s rights.</li>
        <li>All ad creative is reviewed before it goes live and may be rejected at our discretion, including after automated content screening. We do not guarantee approval, any particular placement, or any level of reach or results.</li>
        <li>Payment is collected up front via Stripe Checkout for the number of days you select. If we reject your submission, or later pull an already-live ad for a policy violation, we will refund the payment for that campaign. Campaigns that run to completion as approved are non-refundable.</li>
        <li>We may pause or remove any live ad at our discretion, including after it has started running, if we determine it violates these Terms, our Community Guidelines, or applicable law.</li>
      </ul>
      <p className="mt-2 text-foreground-soft">
        If you are a user viewing an ad on YuKon3t: ads are paid content
        submitted by third parties, reviewed by us before publication but
        not verified for accuracy, and their appearance on YuKon3t is not an
        endorsement by us of the advertiser or its products or services.
        Clicking through to an advertiser&apos;s link takes you to a site or
        service we do not control — see our{" "}
        <a href="/legal/disclaimer" className="text-accent">Disclaimer</a>.
      </p>
      <p className="mt-2 text-foreground-soft">
        <b>No auto-renewal, anywhere on YuKon3t.</b> An ad booking is a
        single, one-time charge for the exact number of days you select at
        checkout (California Automatic Renewal Law and equivalent state
        disclosure laws) — it does not renew automatically, does not
        recur, and is not a subscription; running it again later requires a
        new booking and a new charge. Every other use of the word
        &quot;subscribe&quot; on YuKon3t — subscribing to a person&apos;s
        posts, a Circle, or a Muse creator — is a free, one-tap social
        follow with no payment involved at all; toggling it off (the same
        button you used to subscribe) unsubscribes you instantly, with
        nothing further to cancel.
      </p>

      <h2 className="mt-8 font-semibold">10. Termination</h2>
      <p className="mt-2 text-foreground-soft">
        You may delete your account at any time from Settings, free, with no
        retention period or paywall. We may suspend or terminate your access
        to YuKon3t if you violate these Terms or our Community Guidelines,
        or if we reasonably believe termination is necessary to protect
        YuKon3t or its users. Where practical, we will state a reason and
        provide an appeal path, as described in the Guidelines.
      </p>
      <p className="mt-2 text-foreground-soft">
        We may also suspend or terminate any account or your access to all
        or part of YuKon3t for any other reason, or no reason, with
        reasonable notice where practical — for example, if we discontinue
        YuKon3t or a feature of it. This does not limit any other right or
        remedy we have.
      </p>
      <p className="mt-2 text-foreground-soft">
        <b>Effect of termination.</b> Upon termination, your right to access
        and use YuKon3t ends immediately. Sections 4 (as to the license
        wind-down described there), 11 through 17, and this sentence survive
        termination of your account or these Terms, along with any other
        provision that by its nature should survive.
      </p>

      <h2 className="mt-8 font-semibold">11. Disclaimers</h2>
      <p className="mt-2 text-foreground-soft">
        YuKon3t is provided &quot;as is&quot; and &quot;as available,&quot;
        without warranties of any kind, whether express, implied, or
        statutory, including implied warranties of merchantability, fitness
        for a particular purpose, and non-infringement. We do not warrant
        that YuKon3t will be uninterrupted, error-free, or completely
        secure, that any other user is who they claim to be, or that any
        advertised product or service is as described. See our{" "}
        <a href="/legal/disclaimer" className="text-accent">Disclaimer</a>{" "}
        for important information about interacting with and meeting other
        users.
      </p>

      <h2 className="mt-8 font-semibold">12. Limitation of liability</h2>
      <p className="mt-2 text-foreground-soft">
        To the maximum extent permitted by law, YuKon3t and its operators
        will not be liable for any indirect, incidental, special,
        consequential, or punitive damages, or any loss of data, use,
        goodwill, or other intangible losses, arising from your use of or
        inability to use YuKon3t, from the conduct of any user or third
        party, or from any ad or advertiser you interact with through
        YuKon3t, even if advised of the possibility of such damages. Where
        liability cannot be excluded by law, our total liability is limited
        to the greater of the amount you paid us in the past 12 months (if
        any) or fifty US dollars ($50).
      </p>

      <h2 className="mt-8 font-semibold">13. Indemnification</h2>
      <p className="mt-2 text-foreground-soft">
        You agree to indemnify, defend, and hold harmless Motiff Core
        Holdings and YuKon3t, and our officers, employees, and agents, from
        any claims, damages, liabilities, and expenses (including reasonable
        legal fees) arising from your use of YuKon3t, your User Content, any
        ad you submit as an Advertiser, or your violation of these Terms or
        any applicable law. We reserve the right, at our own expense, to
        assume the exclusive defense and control of any matter otherwise
        subject to indemnification by you, in which case you agree to
        cooperate with our defense of that claim.
      </p>

      <h2 className="mt-8 font-semibold">14. Governing law</h2>
      <p className="mt-2 text-foreground-soft">
        These Terms, and any dispute arising out of or relating to them, the
        Privacy Policy, or your use of YuKon3t, are governed by the laws of
        the State of Delaware, USA, without regard to its conflict-of-laws
        principles. Subject to Section 15 (Binding Arbitration Agreement and
        Class Action Waiver) below, the state and federal courts located in
        Delaware have exclusive jurisdiction over any dispute not resolved
        through arbitration or brought in small claims court, and you and we
        each consent to personal jurisdiction there. Nothing in this Section
        overrides any right you may have under mandatory consumer-protection
        law in your own jurisdiction to bring a claim in your local courts.
      </p>

      <h2 className="mt-8 font-semibold">
        15. Binding arbitration agreement and class action waiver
      </h2>
      <p className="mt-2 text-foreground-soft">
        <b>
          Please read this section carefully — it affects your legal rights,
          including your right to file a lawsuit in court and to participate
          in a class action.
        </b>
      </p>
      <p className="mt-2 text-foreground-soft">
        <b>Informal resolution first.</b> Before filing an arbitration
        demand or a small claims action, you agree to first contact us and
        give us 30 days to try to resolve the dispute informally.
      </p>
      <p className="mt-2 text-foreground-soft">
        <b>Agreement to arbitrate.</b> You and Motiff Core Holdings agree
        that any dispute, claim, or controversy arising out of or relating
        to these Terms, the Privacy Policy, or your use of YuKon3t
        (&quot;Dispute&quot;) that is not resolved informally or in small
        claims court will be resolved by binding, individual arbitration
        administered by the American Arbitration Association
        (&quot;AAA&quot;) under its Consumer Arbitration Rules then in
        effect, rather than in court, except that either party may bring an
        individual Dispute in small claims court if it qualifies, and either
        party may seek injunctive relief in court to prevent infringement of
        intellectual property rights or unauthorized access to or misuse of
        YuKon3t. This agreement to arbitrate is governed by the Federal
        Arbitration Act. The arbitrator, not any court, will decide all
        disputes about the interpretation, applicability, or enforceability
        of this arbitration agreement, except that only a court decides the
        validity and effect of the Class Action Waiver below.
      </p>
      <p className="mt-2 text-foreground-soft">
        <b>Class action waiver.</b> You and Motiff Core Holdings each agree
        that any Dispute will be brought only in an individual capacity, and
        not as a plaintiff or class member in any purported class,
        collective, consolidated, or representative action or arbitration.
        The arbitrator may not consolidate more than one person&apos;s
        claims and may not otherwise preside over any form of a
        representative or class proceeding. If a court or arbitrator decides
        that this Class Action Waiver is unenforceable as to a particular
        claim or request for relief, that particular claim or request for
        relief must be brought in court, severed from any arbitration, and
        every remaining claim or request for relief remains subject to
        arbitration on an individual basis.
      </p>
      <p className="mt-2 text-foreground-soft">
        <b>Coordinated/mass filings.</b> If 25 or more similar arbitration
        demands represented by the same or coordinated counsel or entities
        are filed against us within a short period, we may ask AAA to apply
        its Mass Arbitration Supplementary Rules (or an equivalent
        batching/staged-filing procedure it makes available), and you agree
        that your Dispute may be resolved under those procedures rather than
        as a fully separate proceeding.
      </p>
      <p className="mt-2 text-foreground-soft">
        <b>Opting out.</b> You may opt out of this arbitration agreement and
        the Class Action Waiver by contacting us within 30 days of first
        creating your account (or, for an existing account, within 30 days
        of the date this Section is added or materially changed), stating
        your username and that you wish to opt out of arbitration. If you
        opt out, any Dispute between you and us will instead be resolved as
        described in Section 14 (Governing Law), and the Class Action Waiver
        in this Section will not apply to you.
      </p>
      <p className="mt-2 text-foreground-soft">
        <b>Outside the United States.</b> If you are located in the European
        Economic Area, the United Kingdom, Switzerland, Australia, or
        another jurisdiction where mandatory pre-dispute arbitration or a
        waiver of class or representative actions is not enforceable against
        consumers under local law, this Section 15 applies only to the
        extent permitted by that law, and any Dispute we cannot arbitrate as
        a result will instead be resolved as described in Section 14
        (Governing Law), including in your local courts where mandatory
        consumer-protection law requires it.
      </p>

      <h2 className="mt-8 font-semibold">16. Changes to these Terms</h2>
      <p className="mt-2 text-foreground-soft">
        We may update these Terms as YuKon3t evolves. Material changes will
        be announced in-app or by email before they take effect. Continued
        use of YuKon3t after a change takes effect constitutes acceptance of
        the updated Terms.
      </p>

      <h2 className="mt-8 font-semibold">17. General</h2>
      <p className="mt-2 text-foreground-soft">
        If any provision of these Terms is found unenforceable, the
        remaining provisions remain in full effect (see also the
        arbitration-specific severability rule in Section 15). Our failure
        to enforce any right or provision is not a waiver of that right.
        These Terms, together with the Privacy Policy, Community Guidelines,
        and Disclaimer, constitute the entire agreement between you and
        Motiff Core Holdings regarding your use of YuKon3t.
      </p>
    </div>
  );
}
