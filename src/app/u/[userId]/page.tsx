import { notFound } from "next/navigation";
import Link from "next/link";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { TrustBadge } from "@/components/trust-badge";
import { ConnectButton } from "@/components/connect-button";
import { ReportTrigger } from "@/components/report-form";
import { BlockButton } from "@/components/block-button";
import { CallButton } from "@/components/call-button";
import { PostComposer } from "@/components/post-composer";
import { ProfileComposeFocus } from "@/components/profile-compose-focus";
import { ProfilePostFab } from "@/components/profile-post-fab";
import { ProfilePostsList } from "@/components/profile-posts-list";
import { EditProfileForm } from "@/components/edit-profile-form";
import { BackButton } from "@/components/back-button";
import { ProfileStoryRing } from "@/components/profile-story-ring";
import { PostMuseButton } from "@/components/post-muse-button";
import { postCardInclude, attachViewerState } from "@/lib/post-card-data";
import { getVisiblePostsWhere, LEAD_POST_ONLY } from "@/lib/post-visibility";
import { isOnline } from "@/lib/presence";
import { ScreenshotContextTracker } from "@/components/screenshot-context-tracker";
import { COUNTRIES } from "@/lib/countries";
import { LANGUAGES } from "@/lib/languages";
import { INTERESTS } from "@/lib/interests";
import { formatTimeAgo } from "@/lib/format-date";
import { countryName } from "@/lib/i18n/country-names";
import { interestName, languageName } from "@/lib/i18n/language-names";
import { aroundPlaceholder, format, plural, type Locale } from "@/lib/i18n/locales";
import { getDictionary, getLocale } from "@/lib/i18n/server";

/** "3 subscribers" with the number in bold, wherever the language's plural form puts it. */
function BoldCount({ locale, forms, count }: { locale: Locale; forms: string; count: number }) {
  const text = plural(locale, forms, count);
  const digits = String(count);
  const at = text.indexOf(digits);
  // A form that spells its number out ("one subscriber") has no digits to pick out.
  if (at === -1) return <span className="text-foreground-soft">{text}</span>;
  return (
    <>
      <span className="text-foreground-soft">{text.slice(0, at)}</span>
      <span className="font-semibold">{digits}</span>
      <span className="text-foreground-soft">{text.slice(at + digits.length)}</span>
    </>
  );
}

// Same cursor pagination as /connections/page.tsx, auto-loaded further pages
// as the viewer scrolls (see ProfilePostsList / loadMoreProfilePosts).
const POSTS_PAGE_SIZE = 20;

export default async function PublicProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ error?: string; saved?: string; story?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { userId } = await params;
  const { error, saved, story: storyParam } = await searchParams;
  const locale = await getLocale();
  const dictionary = await getDictionary();
  const t = dictionary.profile.page;
  const [beforeName, afterName] = aroundPlaceholder(t.connectionsOnly, "name");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== "ACTIVE" || !user.name) notFound();
  const isOwnProfile = user.id === me.id;
  // Site admins are invisible platform-wide — see the same guard on
  // /u/[userId]/subscribers and /subscribing, and the isAdmin exclusions
  // in search/discover and requestConnection/startDirectMessage. Skipped
  // only for the admin viewing their own profile.
  if (user.isAdmin && !isOwnProfile) notFound();
  const online = isOnline(user.lastSeenAt);

  const iBlockedThem = isOwnProfile
    ? false
    : !!(await prisma.block.findUnique({
        where: { blockerId_blockedId: { blockerId: me.id, blockedId: user.id } },
      }));

  const connection = isOwnProfile
    ? null
    : await prisma.connection.findFirst({
        where: {
          OR: [
            { requesterId: me.id, targetId: user.id },
            { requesterId: user.id, targetId: me.id },
          ],
        },
      });

  const conversationId =
    connection?.status === "ACCEPTED"
      ? (
          await prisma.conversation.findFirst({
            where: {
              AND: [
                { members: { some: { userId: me.id } } },
                { members: { some: { userId: user.id } } },
              ],
            },
            select: { id: true },
          })
        )?.id ?? null
      : null;

  const [subscriberCount, subscribingCount] = await Promise.all([
    prisma.subscription.count({ where: { subscribedToId: user.id } }),
    prisma.subscription.count({ where: { subscriberId: user.id } }),
  ]);

  const canSeePosts =
    !iBlockedThem &&
    (isOwnProfile ||
      (user.postsVisibility !== "HIDDEN" &&
        (user.postsVisibility === "PUBLIC" || connection?.status === "ACCEPTED")));

  // canSeePosts above is a cheap account-level bail-out (skips the query
  // entirely for a blocked/HIDDEN author); getVisiblePostsWhere is what
  // actually enforces each individual post's own Everyone/Friends only/
  // Private choice underneath that.
  const rawPosts = canSeePosts
    ? await prisma.post.findMany({
        // AND, not a flat spread — see loadMoreProfilePosts (actions/posts.ts)'s
        // identical query for why getVisiblePostsWhere and LEAD_POST_ONLY
        // can't both be spread into the same object.
        where: {
          authorId: user.id,
          circleId: null,
          AND: [await getVisiblePostsWhere(me.id), LEAD_POST_ONLY],
        },
        orderBy: { createdAt: "desc" },
        take: POSTS_PAGE_SIZE,
        include: postCardInclude,
      })
    : [];
  const posts = await attachViewerState(rawPosts, me.id);
  const postsHaveMore = rawPosts.length === POSTS_PAGE_SIZE;

  const activeStories = canSeePosts
    ? await prisma.story.findMany({
        where: { authorId: user.id, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "asc" },
        include: { _count: { select: { views: true } } },
      })
    : [];
  const storiesForRing = activeStories.map((s) => ({
    id: s.id,
    mediaType: s.mediaType,
    mediaUrl: s.mediaUrl,
    mediaThumbnailUrl: s.mediaThumbnailUrl,
    embedProvider: s.embedProvider,
    embedId: s.embedId,
    caption: s.caption,
    createdAt: s.createdAt,
    viewCount: s._count.views,
    sharedPostId: s.sharedPostId,
  }));

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <ScreenshotContextTracker context={{ type: "profile", id: userId }} />
      <BackButton label={dictionary.shell.common.back} />

      {saved && (
        <p role="status" className="mb-4 rounded-lg bg-success/10 px-4 py-2 text-sm text-success">
          {t.updated}
        </p>
      )}
      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-danger/10 px-4 py-2 text-sm text-danger">
          {error === "moderation" ? t.errors.moderation : t.errors.other}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-4">
          <ProfileStoryRing
            userId={user.id}
            avatarUrl={user.avatarUrl}
            name={user.name}
            stories={storiesForRing}
            isOwner={isOwnProfile}
            currentUserId={me.id}
            online={online}
            initialStoryId={storyParam}
          />
          <div className="min-w-0">
            <h1 dir="auto" className="break-words text-2xl font-semibold">{user.name}</h1>
            <p className="text-sm text-foreground-soft">
              {user.country ? countryName(user.country, locale) : dictionary.feed.people.unknownLocation}
            </p>
            {!isOwnProfile && (
              <p className="text-xs text-foreground-soft">
                {online ? (
                  <span className="text-success">● {t.onlineNow}</span>
                ) : user.lastSeenAt ? (
                  format(t.lastSeen, { when: formatTimeAgo(user.lastSeenAt, locale, dictionary.ui.time.justNow) })
                ) : (
                  t.offline
                )}
              </p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <Link href={`/u/${user.id}/subscribers`} className="hover:text-accent hover:underline">
                <BoldCount locale={locale} forms={t.subscribers} count={subscriberCount} />
              </Link>
              <Link href={`/u/${user.id}/subscribing`} className="hover:text-accent hover:underline">
                <BoldCount locale={locale} forms={t.subscribing} count={subscribingCount} />
              </Link>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isOwnProfile && user.currentStreak > 0 && (
            <span className="text-xs text-foreground-soft">
              🔥 {plural(locale, dictionary.feed.streak.days, user.currentStreak)}
              {user.longestStreak > user.currentStreak &&
                ` · ${format(dictionary.feed.streak.best, { count: user.longestStreak })}`}
            </span>
          )}
          {isOwnProfile && <PostMuseButton />}
          <TrustBadge band={user.trustBand} />
        </div>
      </div>

      {user.bio && <p dir="auto" className="mt-4 break-words text-sm">{user.bio}</p>}

      {user.interests.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {user.interests.map((i) => (
            <span
              key={i}
              className="rounded-full bg-line px-2.5 py-0.5 text-xs text-foreground-soft"
            >
              {interestName(i, dictionary.vocab.interests)}
            </span>
          ))}
        </div>
      )}

      {isOwnProfile ? (
        <div className="mt-6">
          <EditProfileForm
            user={{
              name: user.name,
              bio: user.bio,
              country: user.country,
              languages: user.languages,
              interests: user.interests,
              openToIntents: user.openToIntents,
              avatarUrl: user.avatarUrl,
            }}
            countryOptions={COUNTRIES.map((c) => ({ value: c, label: countryName(c, locale) }))}
            languageOptions={LANGUAGES.map((l) => ({
              value: l,
              label: languageName(l, locale, dictionary.vocab.languages),
            }))}
            interestOptions={INTERESTS.map((i) => ({ value: i, label: interestName(i, dictionary.vocab.interests) }))}
            multiSelectLabels={dictionary.shared.multiSelect}
          />
        </div>
      ) : iBlockedThem ? (
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <p className="text-sm text-foreground-soft">{t.blocked}</p>
          <BlockButton targetId={user.id} targetName={user.name} initiallyBlocked />
        </div>
      ) : (
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <ConnectButton
            targetId={user.id}
            openToIntents={user.openToIntents}
            status={connection?.status ?? null}
            isRequester={connection?.requesterId === me.id}
            conversationId={conversationId}
          />
          {connection?.status === "ACCEPTED" && (
            <CallButton calleeId={user.id} calleeName={user.name} currentUserId={me.id} />
          )}
          <ReportTrigger targetType="USER" targetId={user.id} reportedUserId={user.id} label={t.reportAccount} />
          <BlockButton targetId={user.id} targetName={user.name} initiallyBlocked={false} />
        </div>
      )}

      <div className="mt-10 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
          {isOwnProfile ? t.yourPosts : t.posts}
        </h2>
        {isOwnProfile && (
          <div id="profile-composer">
            <ProfileComposeFocus />
            <PostComposer
              defaultVisibility={me.postsVisibility === "CONNECTIONS_ONLY" ? "CONNECTIONS_ONLY" : "PUBLIC"}
              authorName={me.name}
              authorAvatarUrl={me.avatarUrl}
            />
          </div>
        )}
        {isOwnProfile && <ProfilePostFab />}
        {!canSeePosts && (
          <p className="text-sm text-foreground-soft">
            {beforeName}
            <bdi>{user.name}</bdi>
            {afterName}
          </p>
        )}
        {canSeePosts && posts.length === 0 && (
          <p className="text-sm text-foreground-soft">
            {isOwnProfile ? t.emptyOwn : t.empty}
          </p>
        )}
        {canSeePosts && posts.length > 0 && (
          <ProfilePostsList
            profileUserId={user.id}
            initialPosts={posts}
            initialHasMore={postsHaveMore}
            viewerId={me.id}
            viewerIsAdmin={me.isAdmin}
          />
        )}
      </div>
    </div>
  );
}
