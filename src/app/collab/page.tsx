import Link from "next/link";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { ReportTrigger } from "@/components/report-form";
import { TrustBadge } from "@/components/trust-badge";
import { UserLink } from "@/components/user-link";
import { PostConnectPopover } from "@/components/post-connect-popover";
import { SubscribeButton } from "@/components/subscribe-button";
import { getAuthorEngagementStatus, engagementStatusFor } from "@/lib/engagement-status";
import { countryName } from "@/lib/i18n/country-names";
import { vocabName } from "@/lib/i18n/language-names";
import { aroundPlaceholder, plural } from "@/lib/i18n/locales";
import { getDictionary, getLocale } from "@/lib/i18n/server";

type SortOption = "recent" | "oldest";

export default async function CollabPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { sort: sortParam } = await searchParams;
  const sort: SortOption = sortParam === "oldest" ? "oldest" : "recent";
  const locale = await getLocale();
  const dictionary = await getDictionary();
  const t = dictionary.collab.board;
  const [byBefore, byAfter] = aroundPlaceholder(t.by, "name");
  const typeName = (type: string) => vocabName(type, dictionary.vocab.collabTypes);
  const where = (post: { worldwide: boolean; countries: string[] }) =>
    post.worldwide
      ? t.worldwide
      : post.countries.map((country) => countryName(country, locale)).join(dictionary.ui.listSeparator);

  const posts = await prisma.collabBoardPost.findMany({
    where: { status: "OPEN", visibility: "PUBLIC" },
    orderBy: { createdAt: sort === "oldest" ? "asc" : "desc" },
    take: 40,
    include: {
      author: {
        select: { id: true, name: true, username: true, avatarUrl: true, trustBand: true, openToIntents: true },
      },
      _count: { select: { participants: true } },
    },
  });

  // Private collabs are never listed above — surface the viewer's own ones
  // here instead, so they're reachable from somewhere other than a
  // notification link.
  const privatePosts = await prisma.collabBoardPost.findMany({
    where: {
      status: "OPEN",
      visibility: "PRIVATE",
      OR: [{ authorId: me.id }, { participants: { some: { userId: me.id } } }],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      author: { select: { id: true, name: true, username: true, avatarUrl: true } },
      _count: { select: { participants: true } },
    },
  });

  const engagementByAuthorId = await getAuthorEngagementStatus(
    me.id,
    posts.map((p) => p.author.id),
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t.title}</h1>
          <p className="mt-1 text-sm text-foreground-soft">
            {t.intro}
          </p>
        </div>
        <Link
          href="/collab/new"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink"
        >
          {t.post}
        </Link>
      </div>

      <form className="mt-6 flex items-center gap-3 text-sm">
        <select
          name="sort"
          aria-label={t.sortLabel}
          defaultValue={sort}
          className="rounded-lg border border-line bg-surface px-3 py-2"
        >
          <option value="recent">{t.recent}</option>
          <option value="oldest">{t.oldest}</option>
        </select>
        <button
          type="submit"
          className="rounded-lg border border-line px-3 py-2 font-medium hover:border-accent hover:text-accent"
        >
          {t.apply}
        </button>
      </form>

      <div className="mt-8 space-y-4">
        {posts.map((post) => {
          const engagement = engagementStatusFor(engagementByAuthorId, post.author.id);
          return (
          <div key={post.id} className="rounded-xl border border-line p-4">
            <Link href={`/collab/${post.id}`} className="block">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-xs font-medium text-teal">
                  {typeName(post.type)}
                </span>
                <span className="break-words text-end text-xs text-foreground-soft">{where(post)}</span>
              </div>
              <h2 dir="auto" className="mt-2 break-words font-semibold hover:text-accent">{post.title}</h2>
              <p dir="auto" className="mt-1 break-words text-sm text-foreground-soft">{post.description}</p>
              <p className="mt-1 text-xs text-foreground-soft">
                {plural(locale, t.participants, post._count.participants)}
              </p>
            </Link>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {byBefore.trim() && <span className="text-xs text-foreground-soft">{byBefore.trim()}</span>}
                <UserLink
                  userId={post.author.id}
                  name={post.author.name}
                  username={post.author.username}
                  avatarUrl={post.author.avatarUrl}
                  avatarSize={18}
                  className="text-xs font-medium"
                />
                {byAfter.trim() && <span className="text-xs text-foreground-soft">{byAfter.trim()}</span>}
                <TrustBadge band={post.author.trustBand} />
              </div>
              <div className="flex items-center gap-3">
                {post.author.id !== me.id && (
                  <>
                    <PostConnectPopover
                      targetId={post.author.id}
                      openToIntents={post.author.openToIntents}
                      status={engagement.connectionStatus}
                      isRequester={engagement.connectionIsRequester}
                      conversationId={engagement.conversationId}
                    />
                    <SubscribeButton
                      targetId={post.author.id}
                      initiallySubscribed={engagement.subscribedByMe}
                      variant="icon"
                    />
                  </>
                )}
                <ReportTrigger
                  targetType="COLLAB_POST"
                  targetId={post.id}
                  reportedUserId={post.author.id}
                />
              </div>
            </div>
          </div>
          );
        })}
        {posts.length === 0 && (
          <p className="text-sm text-foreground-soft">
            {t.empty}
          </p>
        )}
      </div>

      {privatePosts.length > 0 && (
        <div className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
            {t.privateHeading}
          </h2>
          <p className="mt-1 text-xs text-foreground-soft">
            {t.privateIntro}
          </p>
          <div className="mt-3 space-y-3">
            {privatePosts.map((post) => (
              <Link
                key={post.id}
                href={`/collab/${post.id}`}
                className="block rounded-xl border border-line p-4 hover:border-accent"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded-full bg-teal/10 px-2.5 py-0.5 text-xs font-medium text-teal">
                    {typeName(post.type)}
                  </span>
                  <span className="rounded-full bg-line px-2 py-0.5 text-[0.6875rem] text-foreground-soft">
                    {t.private}
                  </span>
                </div>
                <h3 dir="auto" className="mt-2 break-words font-semibold">{post.title}</h3>
                <p className="mt-1 text-xs text-foreground-soft">
                  {byBefore}
                  <bdi>{post.author.name}</bdi>
                  {byAfter} · {plural(locale, t.participants, post._count.participants)}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
