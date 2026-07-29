import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

const pillars = [
  {
    title: "Verified before you message",
    body: "Every account confirms its email before DMs unlock, and every action taken against an account comes with a stated reason and an appeal path — no silent bans.",
  },
  {
    title: "Say what you're here for",
    body: "Tag your intent — friendship, cultural exchange, professional, community, or dating — so conversations never drift into something you didn't sign up for.",
  },
  {
    title: "Free Circles, no organizer tax",
    body: "Create or join interest and identity communities for free. No per-year organizer fees.",
  },
  {
    title: "Your data is always yours",
    body: "Export or permanently delete your account in one click, free, forever. Never paywalled.",
  },
];

export default async function Home() {
  const session = await auth();
  if (session?.user) {
    redirect("/discover");
  }

  return (
    <div>
      <section className="mx-auto max-w-5xl px-4 py-20 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">
          Global connection, done honestly
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Connect with people worldwide — by interest, by culture, by purpose.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-foreground-soft">
          YuKon3t is built around one idea: every major connection app has a
          trust problem. We fixed the ones that keep showing up in real user
          reviews — fake profiles, opaque moderation, and paywalled safety.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link
            href="/sign-in"
            className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-ink"
          >
            Get started free
          </Link>
          <Link
            href="/legal/guidelines"
            className="rounded-full border border-line px-6 py-3 text-sm font-semibold hover:border-accent hover:text-accent"
          >
            Read our guidelines
          </Link>
        </div>
      </section>

      <section className="border-t border-line bg-surface py-16">
        <div className="mx-auto grid max-w-5xl gap-8 px-4 sm:grid-cols-2">
          {pillars.map((pillar) => (
            <div key={pillar.title} className="rounded-xl border border-line p-6">
              <h2 className="text-lg font-semibold">{pillar.title}</h2>
              <p className="mt-2 text-sm text-foreground-soft">{pillar.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16 text-center">
        <h2 className="text-2xl font-semibold">Two ways to connect</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="rounded-xl border border-line p-6 text-left">
            <h3 className="font-semibold text-teal">Circles</h3>
            <p className="mt-2 text-sm text-foreground-soft">
              Interest and identity communities — hobbies, causes, cultures.
              Free to create and join.
            </p>
          </div>
          <div className="rounded-xl border border-line p-6 text-left">
            <h3 className="font-semibold text-teal">Collab Boards</h3>
            <p className="mt-2 text-sm text-foreground-soft">
              Cross-country skill exchanges, volunteering, study groups, and
              projects — the connection type most global apps skip.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
