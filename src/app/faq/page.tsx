import type { ReactNode } from "react";

type Faq = { q: string; a: ReactNode };
type Section = { title: string; items: Faq[] };

const sections: Section[] = [
  {
    title: "Getting around",
    items: [
      {
        q: "Where do I find everything?",
        a: (
          <>
            On desktop, the top bar has links to Home, Discover, Circles,
            Collab Boards, Connections, Messages, and your Profile. On a
            phone, the five most-used sections (Home, Circles, Collab,
            Messages, Profile) sit in a bottom tab bar — tap the ☰ menu in
            the top-right for Discover, Connections, Settings, and (for
            admins) Moderation tools.
          </>
        ),
      },
      {
        q: "Can I swipe between tabs instead of tapping?",
        a: (
          <>
            Yes, on a phone: swipe right anywhere on the screen to move
            forward through Home → Circles → Collab → Messages → Profile,
            wrapping back around to Home. Swipe left from any of them to
            jump straight to your Profile.
          </>
        ),
      },
      {
        q: "What's the difference between Home, Discover, and Connections?",
        a: (
          <>
            <strong>Home</strong> is your feed — posts from people you&apos;re
            connected to and Circles you&apos;ve joined. <strong>Discover</strong>{" "}
            is how you find new people by country, language, or interest.{" "}
            <strong>Connections</strong> is your list of accepted connections
            plus any pending requests you&apos;ve sent or received.
          </>
        ),
      },
      {
        q: "How do I switch between light and dark mode?",
        a: (
          <>
            Use the theme toggle next to Settings in the top bar (or in the
            ☰ menu on mobile). It follows your device by default, but you can
            pin it to light or dark.
          </>
        ),
      },
      {
        q: "How do I search the app?",
        a: (
          <>
            Tap the magnifying-glass icon next to your notification bell.
            One search box covers people, Circles, group chats, and
            Collaborations at once — filter results by most relevant, most
            recent, oldest, &ldquo;current affairs&rdquo; (active in the last
            two weeks), or a specific country.
          </>
        ),
      },
      {
        q: "Why can I click someone's name almost everywhere?",
        a: (
          <>
            Any name or profile picture you see — in a chat, a comment, a
            connection list, a Circle&apos;s member list, and so on — links
            straight to that person&apos;s profile. It&apos;s the same
            click-through everywhere on purpose, so you never have to hunt
            for a &ldquo;view profile&rdquo; button.
          </>
        ),
      },
    ],
  },
  {
    title: "The Android app",
    items: [
      {
        q: "The app opens in Chrome instead of full-screen — how do I fix that?",
        a: (
          <>
            This is a one-time Android setting, not a bug. Go to your
            phone&apos;s Settings → Apps → YuKon3t → &ldquo;Open by
            default&rdquo; (some Android versions call this &ldquo;Set as
            default&rdquo; or &ldquo;Supported links&rdquo;), and make sure{" "}
            <code>yukon3t.com</code> is toggled on under &ldquo;Supported web
            addresses.&rdquo; Android turns this off by default as a privacy
            control — the app can&apos;t switch it on for you, so it&apos;s a
            one-time manual step after installing.
          </>
        ),
      },
    ],
  },
  {
    title: "Posts and media",
    items: [
      {
        q: "What can I post?",
        a: (
          <>
            Text, photos, and videos from your device or camera, an image
            pulled from a URL, or an embedded YouTube/Vimeo link. Tap the
            camera/photo icons in the composer — each opens a small menu for
            device, camera, or link, so there&apos;s one button for photos
            and one for videos rather than a row of separate buttons.
          </>
        ),
      },
      {
        q: "Why was my photo or video rejected?",
        a: (
          <>
            Every upload is screened automatically before it&apos;s visible
            to anyone else. Content that violates our{" "}
            <a href="/legal/guidelines" className="text-accent hover:underline">
              Community Guidelines
            </a>{" "}
            (most commonly sexually explicit material) is rejected and never
            published.
          </>
        ),
      },
      {
        q: "How do I delete a post, or report someone else's?",
        a: (
          <>
            Open the &ldquo;⋯&rdquo; menu on any post for delete (your own
            posts) or report (anyone&apos;s). Reports go to our moderation
            queue and are reviewed with a stated reason either way.
          </>
        ),
      },
    ],
  },
  {
    title: "Stories",
    items: [
      {
        q: "What's a Story?",
        a: (
          <>
            A photo or short video (up to 30 seconds) on your profile that
            disappears automatically after 24 hours. Tap the &ldquo;+&rdquo;
            on your own profile picture to add one — anyone who can see your
            profile can view it while it&apos;s active.
          </>
        ),
      },
      {
        q: "Can people react or reply to my Story?",
        a: (
          <>
            Yes — viewers can tap an emoji to react (you&apos;ll see who
            reacted when you open your own Story) or type a reply, which
            arrives as a direct message. Replying only works between people
            who are already connected, same as regular messaging.
          </>
        ),
      },
    ],
  },
  {
    title: "Connecting, messaging, and calls",
    items: [
      {
        q: "How do I message someone?",
        a: (
          <>
            You need an accepted connection first — send a request from
            their profile or Discover. Once connected, message them from
            Connections or start a new conversation under Messages.
          </>
        ),
      },
      {
        q: "How do I reply to a specific message?",
        a: (
          <>
            Swipe a message to the right (or open its &ldquo;⋯&rdquo; menu
            and tap &ldquo;Reply&rdquo; if you&apos;re on desktop) to quote
            it in your reply — the other person sees exactly which message
            you&apos;re responding to, useful once a chat has moved on to a
            few topics at once.
          </>
        ),
      },
      {
        q: "Can I send photos, videos, or voice notes in a chat?",
        a: (
          <>
            Yes — the chat composer has an &ldquo;Add a photo&rdquo; and
            &ldquo;Add a video&rdquo; button (device, camera, or live
            recording), plus a microphone icon for a recorded voice note.
            Any message you send can be deleted for yourself, or for
            everyone if you sent it.
          </>
        ),
      },
      {
        q: "How do voice and video calls work?",
        a: (
          <>
            Tap the phone or video icon on a connection&apos;s profile or in
            your chat with them. They&apos;ll get a ring (with your chosen
            ringtone — pick one under Settings → Calls) and can accept or
            decline.
          </>
        ),
      },
      {
        q: "It says I \"already have a call\" with someone and won't let me call again — what do I do?",
        a: (
          <>
            This happens if a previous call to that person is still marked
            as ringing or active (for example, if a call got interrupted).
            You&apos;ll see a popup offering to cancel that stuck call and
            immediately place a new one — tap &ldquo;Cancel it &amp; call
            again.&rdquo;
          </>
        ),
      },
    ],
  },
  {
    title: "Circles and Collab Boards",
    items: [
      {
        q: "What's a Circle?",
        a: (
          <>
            A free interest or identity community — hobbies, causes,
            cultures, anything a group of members wants to organize around.
            Anyone can create one; joining and creating are always free.
          </>
        ),
      },
      {
        q: "What's a Collab Board?",
        a: (
          <>
            A place to find cross-country skill exchanges, volunteering,
            study groups, and projects. Posts can be scoped to specific
            countries or marked &ldquo;worldwide&rdquo; if you&apos;re open
            to collaborators from anywhere. Tap a posting to join it — once
            you&apos;re a participant, you get access to that
            collaboration&apos;s group chat (text, photos, and videos) and a
            live video session with screen sharing, in-call reactions, and
            recording.
          </>
        ),
      },
      {
        q: "What do co-admins do in a Circle or Collab Board?",
        a: (
          <>
            A Circle or Collaboration&apos;s creator can promote any
            member/participant to co-admin, giving them the same day-to-day
            management powers (moderating posts, managing members, promoting
            further co-admins) — everything except deleting the whole Circle
            or closing the Collaboration outright, which stays with the
            original creator.
          </>
        ),
      },
    ],
  },
  {
    title: "Advertising",
    items: [
      {
        q: "How do I advertise on YuKon3t?",
        a: (
          <>
            Go to <a href="/advertise" className="text-accent hover:underline">/advertise</a>{" "}
            — no YuKon3t account needed. Submit your company details, ad
            copy, a photo or short video, and pick how many days you want it
            to run; payment is handled securely via Stripe. Every submission
            is reviewed before it goes live, usually within one business
            day.
          </>
        ),
      },
    ],
  },
  {
    title: "Inviting friends",
    items: [
      {
        q: "How do I invite someone from my phone's contacts who isn't on YuKon3t yet?",
        a: (
          <>
            Go to Settings → Invite friends → &ldquo;Invite from
            contacts.&rdquo; On a phone/Android device you can pick contacts
            directly and text them the app link with one tap; everywhere
            else, it opens your device&apos;s share sheet, or you can just
            copy the invite link and send it yourself.
          </>
        ),
      },
    ],
  },
  {
    title: "Your account and data",
    items: [
      {
        q: "I signed in on a new phone or computer — where's all my stuff?",
        a: (
          <>
            Right where you left it. Your posts, photos, videos, messages,
            Circles, and connections live on our servers, not on any single
            device — signing in with the same email or username on any
            device brings everything with it automatically. There&apos;s
            nothing to transfer or restore by hand.
          </>
        ),
      },
      {
        q: "Can I download a copy of my data?",
        a: (
          <>
            Yes — Settings → Your data → &ldquo;Export my data&rdquo; gives
            you a JSON file of everything tied to your account, free, any
            time, as a personal backup.
          </>
        ),
      },
      {
        q: "What's the difference between deactivating and deleting my account?",
        a: (
          <>
            <strong>Deactivate</strong> hides your profile and posts without
            deleting anything — signing back in with your password or email
            link reactivates it automatically. <strong>Delete</strong>{" "}
            permanently removes your profile, posts, messages, and Circles
            you own; this cannot be undone.
          </>
        ),
      },
      {
        q: "I forgot my password.",
        a: (
          <>
            Use &ldquo;Forgot password&rdquo; on the sign-in page. You can
            also sign in with just your email link if you&apos;d rather not
            use a password at all.
          </>
        ),
      },
      {
        q: "Do I need to pick a username when I sign up?",
        a: (
          <>
            No — signing up only asks for your email, a password, and your
            date of birth. We assign you a starting username automatically,
            and you can change it any time from Settings.
          </>
        ),
      },
      {
        q: "It says my account is locked — what happened?",
        a: (
          <>
            After 4 incorrect password attempts, an account locks for 24
            hours as a security measure. Resetting your password (via
            &ldquo;Forgot password&rdquo; on the sign-in page) unlocks it
            immediately — you don&apos;t have to wait out the 24 hours. If
            you&apos;re still stuck, contact support and we can send a reset
            link to your registered email directly.
          </>
        ),
      },
    ],
  },
  {
    title: "Privacy, safety, and trust",
    items: [
      {
        q: "Who can see my posts and profile?",
        a: (
          <>
            Control this under Settings → Privacy: your posts can be visible
            to anyone signed in, or only to your connections, and you can
            opt your profile out of Discover entirely.
          </>
        ),
      },
      {
        q: "What's a trust score / trust badge?",
        a: (
          <>
            A signal built from things like email verification, account
            age, profile completeness, and activity streaks, minus any
            upheld reports against you. It&apos;s a reputation signal, not a
            background check.
          </>
        ),
      },
      {
        q: "How do I report someone or something?",
        a: (
          <>
            Use the &ldquo;⋯&rdquo; menu on a post, comment, or message, or
            the report option on a profile. Every report is triaged, and
            every action taken states a reason — see our{" "}
            <a href="/legal/guidelines" className="text-accent hover:underline">
              Community Guidelines
            </a>{" "}
            for what&apos;s enforced.
          </>
        ),
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-14">
      <h1 className="font-display text-3xl font-semibold">Frequently asked questions</h1>
      <p className="mt-2 text-sm text-foreground-soft">
        Everything you need to find your way around YuKon3t. Can&apos;t find
        an answer here? Reply to any moderation email, or reach out through
        the report flow on the relevant page.
      </p>

      <div className="mt-10 space-y-10">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="font-display text-xl font-semibold text-teal">{section.title}</h2>
            <div className="mt-3 space-y-2">
              {section.items.map((item) => (
                <details
                  key={item.q}
                  className="group rounded-xl border border-line bg-surface p-4 open:shadow-sm"
                >
                  <summary className="cursor-pointer list-none text-sm font-medium marker:content-none">
                    <span className="flex items-center justify-between gap-3">
                      {item.q}
                      <span className="shrink-0 text-foreground-soft transition-transform group-open:rotate-45">
                        +
                      </span>
                    </span>
                  </summary>
                  <div className="mt-2 text-sm leading-relaxed text-foreground-soft">{item.a}</div>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
