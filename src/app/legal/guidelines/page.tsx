import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/seo";

const title = "Community Guidelines — No Silent Bans | YuKon3t";
const description =
  "YuKon3t's moderation policy: every enforcement action gets a stated reason and a real appeal path. Read how we keep communities safe and fair.";

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  // The one address search engines should index, whatever query string a link added (src/lib/seo.ts).
  alternates: { canonical: absoluteUrl("/legal/guidelines") },
  openGraph: {
    type: "website",
    url: "/legal/guidelines",
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

export default function GuidelinesPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-14 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Community Guidelines</h1>
      <p className="mt-2 text-xs text-foreground-soft">Last updated: November 22, 2026</p>
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
        their email or phone number before messaging unlocks.
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
      <p className="mt-2 text-foreground-soft">
        Hate speech means attacking, dehumanizing or calling for harm against
        people because of who they are: race, ethnicity, national origin,
        religion, caste, disability, sex, sexual orientation or gender
        identity. Hate symbols and extremist imagery count too. This rule
        protects everyone, LGBT people included; simply being who you are, or
        talking about it, is never a violation. Explicit threats of violence
        against anyone, and content promoting violence, are not allowed
        either.
      </p>
      <p className="mt-2 text-foreground-soft">
        The same applies to gifts and challenges: no harassing or abusive
        gift notes, no faked or farmed challenge results, and no buying,
        selling or trading of gifts or awards outside YuKon3t. Gifts have no
        cash value. Reported gifts and challenge results can be removed or
        reversed by our moderators.
      </p>

      <h2 className="mt-8 font-semibold">4. Photos and videos</h2>
      <p className="mt-2 text-foreground-soft">
        No sexually explicit content or pornography anywhere on YuKon3t —
        profile pictures, Circle posts, Muse, Stories, chats, or your personal
        feed. Swimwear, shirtless photos, and artistic or other non-explicit
        content are fine. Sexual content involving anyone under 18 is never
        allowed in any form: it is removed at once and results in an
        immediate, permanent ban. No graphic violence (gore, serious injury,
        torture) or content promoting violence, and no hate content or hate
        symbols (see section 3). Linked videos are subject to our content
        policy even though they&apos;re hosted elsewhere — embedding a
        YouTube, Vimeo, TikTok, Instagram, Facebook, or Dailymotion link is
        held to the same standard as uploading the video yourself.
      </p>

      <h2 className="mt-8 font-semibold">5. Respect intellectual property</h2>
      <p className="mt-2 text-foreground-soft">
        Only post content you have the right to share. Don&apos;t upload
        copyrighted photos, video, or writing that isn&apos;t yours without
        permission. See our{" "}
        <a href="/legal/terms" className="text-accent">Terms of Service</a>{" "}
        for how to file or respond to a copyright claim.
      </p>
      <p className="mt-2 text-foreground-soft">
        Reposting someone else&apos;s Story to your feed, Muse or a Circle is
        allowed when they leave &ldquo;Allow others to repost my Stories&rdquo;
        on, and the copy always credits them. Don&apos;t remove or misstate
        that credit, don&apos;t present their Story as your own, and don&apos;t
        repost a Story to mock, harass or expose the person who posted it. A
        repost is your post: these Guidelines apply to it as if you had
        uploaded it yourself.
      </p>

      <h2 className="mt-8 font-semibold">6. Meeting in person and travel safety</h2>
      <p className="mt-2 text-foreground-soft">
        YuKon3t helps you find people for cross-country collaboration,
        travel tips, and real-world meetups through Circles and Collab
        Boards — but we cannot verify anyone&apos;s real-world identity or
        intentions beyond email or phone verification and community trust signals.
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
      <p className="mt-2 text-foreground-soft">
        Posts, comments, Stories, Muse videos, profiles, and Circle and group
        chat names are also screened automatically, for four things only:
        explicit sexual content, sexual content involving minors, graphic
        violence or promotion of violence (including explicit threats), and
        hate content or hate symbols. Swearing on its own is not screened for.
        A flagged post, comment or Muse video isn&apos;t published, or is
        taken down: it stays hidden, visible only to you, until a moderator
        reviews it and either publishes it or removes it. A Story, a
        profile, a profile or cover picture, a photo or video attached to a
        comment, or a name that the screen flags is not accepted when you
        submit it: you&apos;re told, and you can change it. Nothing already
        published or held is deleted automatically, except suspected sexual
        content involving minors, which is removed at once. A problem on our side while checking an
        upload is never treated as a rule violation.
      </p>
      <p className="mt-2 text-foreground-soft">
        The text of your chat messages is not scanned automatically. These
        Guidelines still apply in chats: anyone in a conversation can report
        a message, and our moderators review reports. Photos and videos sent
        in chats are checked automatically for sexual content involving
        minors and explicit sexual content only.
      </p>
    </div>
  );
}
