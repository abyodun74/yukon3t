import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { TrustBadge } from "@/components/trust-badge";
import { ConnectButton } from "@/components/connect-button";
import Link from "next/link";
import { intentTagValues } from "@/lib/validations";

const intentLabels: Record<string, string> = {
  FRIENDSHIP: "Friendship",
  CULTURAL_EXCHANGE: "Cultural Exchange",
  PROFESSIONAL: "Professional",
  COMMUNITY: "Community",
  DATING: "Dating",
};

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string; country?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { intent, country } = await searchParams;

  const people = await prisma.user.findMany({
    where: {
      id: { not: me.id },
      status: "ACTIVE",
      name: { not: null },
      ...(intent ? { openToIntents: { has: intent as never } } : {}),
      ...(country ? { country: { equals: country, mode: "insensitive" } } : {}),
    },
    orderBy: { trustScore: "desc" },
    take: 30,
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Discover people</h1>
      <p className="mt-1 text-sm text-foreground-soft">
        Filter by what you&apos;re both open to — no drifting into
        conversations neither of you signed up for.
      </p>

      <form className="mt-6 flex flex-wrap items-center gap-3 text-sm">
        <select
          name="intent"
          defaultValue={intent ?? ""}
          className="rounded-lg border border-line bg-surface px-3 py-2"
        >
          <option value="">Any intent</option>
          {intentTagValues.map((tag) => (
            <option key={tag} value={tag}>
              {intentLabels[tag]}
            </option>
          ))}
        </select>
        <input
          name="country"
          defaultValue={country ?? ""}
          placeholder="Country"
          className="rounded-lg border border-line bg-surface px-3 py-2"
        />
        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-ink"
        >
          Filter
        </button>
      </form>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {people.map((person) => (
          <div key={person.id} className="rounded-xl border border-line p-4">
            <div className="flex items-center justify-between">
              <Link
                href={`/u/${person.id}`}
                className="font-semibold hover:text-accent"
              >
                {person.name}
              </Link>
              <TrustBadge band={person.trustBand} />
            </div>
            <p className="mt-1 text-xs text-foreground-soft">
              {person.country ?? "Unknown location"}
            </p>
            {person.bio && (
              <p className="mt-2 line-clamp-3 text-sm text-foreground-soft">
                {person.bio}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-1">
              {person.openToIntents.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-teal/10 px-2 py-0.5 text-[11px] text-teal"
                >
                  {intentLabels[tag]}
                </span>
              ))}
            </div>
            <div className="mt-4">
              <ConnectButton targetId={person.id} openToIntents={person.openToIntents} />
            </div>
          </div>
        ))}
        {people.length === 0 && (
          <p className="text-sm text-foreground-soft">
            No one matches those filters yet — try broadening them.
          </p>
        )}
      </div>
    </div>
  );
}
