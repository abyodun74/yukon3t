import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock, Radio } from "lucide-react";
import { getOnboardedUserOrRedirect } from "@/lib/page-guards";
import { prisma } from "@/lib/prisma";
import { PostComposer } from "@/components/post-composer";
import { CircleVoiceRoom } from "@/components/circle-voice-room";
import { CircleMembershipButton } from "@/components/circle-membership-button";
import { DeleteCircleButton } from "@/components/delete-circle-button";
import { CircleCoverUpload } from "@/components/circle-cover-upload";
import { CircleMemberManager } from "@/components/circle-member-manager";
import { CircleMemberList } from "@/components/circle-member-list";
import { CircleJoinRequestManager } from "@/components/circle-join-request-manager";
import { CircleInviteManager } from "@/components/circle-invite-manager";
import { CircleInviteResponse } from "@/components/circle-invite-response";
import { ChannelList } from "@/components/channel-list";
import { CircleSwitcher } from "@/components/circle-switcher";
import { ChannelSettingsModal } from "@/components/channel-settings-modal";
import { CircleDetailsEditModal } from "@/components/circle-details-edit-modal";
import { SubCircleList } from "@/components/sub-circle-list";
import { CIRCLE_CATEGORIES } from "@/lib/circle-categories";
import { CirclePostsList } from "@/components/circle-posts-list";
import { BackButton } from "@/components/back-button";
import { postCardInclude, attachViewerState } from "@/lib/post-card-data";
import { LEAD_POST_ONLY } from "@/lib/post-visibility";
import { isCircleAdmin } from "@/lib/circle-permissions";
import { canSeeCircle, canSeeCircleContent, visibleOrInvitedCircleWhere } from "@/lib/circle-visibility";
import { canInviteToCircle, eligibleCircleInvitees } from "@/lib/circle-invite";
import {
  getAcceptedConnectionUsers,
  loadCircleInviteExclusions,
  loadCircleInvitesForAdmins,
  loadStandingCircleInvites,
} from "@/lib/circle-invite-data";
import { getMyCircles } from "@/app/actions/circles";
import { CirclePostFab } from "@/components/circle-post-fab";
import { PollSection } from "@/components/poll-section";
import { circlePollWhere, getCirclePollAccess, loadPollPage } from "@/lib/polls-data";
import { CircleEventsSection } from "@/components/circle-events-section";
import { circleEventsWhere, loadCircleEventPage } from "@/lib/circle-events-data";
import { vocabName } from "@/lib/i18n/language-names";
import { aroundPlaceholder, plural } from "@/lib/i18n/locales";
import { getDictionary, getLocale } from "@/lib/i18n/server";

// Same cursor pagination as /connections/page.tsx, auto-loaded further pages
// as the viewer scrolls (see CirclePostsList / loadMoreCirclePosts).
const POSTS_PAGE_SIZE = 20;

export default async function CirclePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ channel?: string }>;
}) {
  const me = await getOnboardedUserOrRedirect();
  const { slug } = await params;
  const { channel: requestedSlug } = await searchParams;
  const locale = await getLocale();
  const dictionary = await getDictionary();
  const t = dictionary.circles.page;
  const [subCircleOfBefore, subCircleOfAfter] = aroundPlaceholder(t.subCircleOf, "name");
  // The stored value is the English name; only the label a category is shown under follows the reader's language.
  const categoryOptions = CIRCLE_CATEGORIES.map((category) => ({
    value: category,
    label: vocabName(category, dictionary.vocab.circleCategories),
  }));

  const [circle, { circles: myCircles }] = await Promise.all([
    prisma.circle.findUnique({
      where: { slug },
      include: {
        _count: { select: { members: true, subCircles: true } },
        members: { where: { userId: me.id } },
        // Set only on a sub-circle: its main Circle, for the "Part of …" link (shown only if the viewer may see it).
        parent: {
          select: { name: true, slug: true, visibility: true, members: { where: { userId: me.id }, select: { id: true } } },
        },
        // Set only on a main Circle: its sub-circles, listed on this page. A PRIVATE one only for its members, and for
        // someone it invited (a standing invite, checked below): to anyone else it doesn't exist.
        subCircles: {
          where: visibleOrInvitedCircleWhere(me.id),
          orderBy: { createdAt: "asc" },
          include: {
            _count: { select: { members: true } },
            members: { where: { userId: me.id }, select: { role: true } },
          },
        },
        channels: {
          orderBy: { position: "asc" },
          include: { members: { select: { userId: true } } },
        },
      },
    }),
    getMyCircles(),
  ]);

  if (!circle) notFound();

  const isMember = circle.members.length > 0;
  // A PRIVATE Circle doesn't exist for a non-member (lib/circle-visibility.ts): the same 404 as a Circle that was never
  // created, site admins included (they have /admin/circles). The one exception is a standing invite, which shows the
  // Circle's header and the Accept/Decline prompt, and nothing inside it.
  const myInvite =
    circle.visibility === "PRIVATE" && !isMember
      ? ((await loadStandingCircleInvites(me.id, [circle])).get(circle.id) ?? null)
      : null;
  if (!canSeeCircle(circle, { isMember, hasStandingInvite: !!myInvite })) notFound();

  const isOwner = circle.createdById === me.id;
  // Only someone who may see inside the Circle gets anything past its header; isCircleAdmin's site-admin shortcut never
  // opens a PRIVATE Circle the admin isn't a member of.
  const isPrivateNonMember = !canSeeCircleContent(circle, isMember);
  const canModerate = !isPrivateNonMember && isCircleAdmin(circle, circle.members[0] ?? null, me);
  // Inviting is the owner's and co-admins' only, by membership role — no site-admin shortcut (see inviteToCircle).
  const canInvite = circle.visibility === "PRIVATE" && canInviteToCircle(circle, circle.members[0] ?? null, me.id);
  // The main Circle, for the "Sub-circle of …" link and Back, only when the viewer may see it.
  const visibleParent =
    circle.parent && canSeeCircle(circle.parent, { isMember: circle.parent.members.length > 0 }) ? circle.parent : null;

  const accessibleChannels = circle.channels.filter(
    (c) => c.visibility === "PUBLIC" || canModerate || c.members.some((m) => m.userId === me.id),
  );
  const activeChannel =
    accessibleChannels.find((c) => c.slug === requestedSlug) ??
    accessibleChannels.find((c) => c.slug === "general") ??
    accessibleChannels[0] ??
    null;

  // See the BackButton below. `defaultChannel` mirrors what this page lands on with no `?channel=` in the URL.
  const defaultChannel = accessibleChannels.find((c) => c.slug === "general") ?? accessibleChannels[0] ?? null;
  const backHref =
    requestedSlug && activeChannel && activeChannel.id !== defaultChannel?.id
      ? `/circles/${circle.slug}`
      : visibleParent
        ? `/circles/${visibleParent.slug}`
        : "/circles";

  // None of these four depend on one another — each only needs `circle`/
  // `canModerate`/`activeChannel`, already resolved above — so they run
  // together rather than as four sequential round trips.
  const [pendingJoinRequests, rawPosts, allMembers, circleLiveStreams, subCircleInvites] = await Promise.all([
    // Join requests sent before PRIVATE Circles became invite-only: nobody can send a new one, but the admins can still
    // answer these (the requester no longer sees the Circle).
    canModerate && circle.visibility === "PRIVATE"
      ? prisma.circleJoinRequest.findMany({
          where: { circleId: circle.id, status: "PENDING" },
          orderBy: { createdAt: "asc" },
          include: { user: { select: { id: true, name: true, username: true, avatarUrl: true } } },
        })
      : Promise.resolve([]),

    activeChannel?.type === "TEXT" && !isPrivateNonMember
      ? prisma.post.findMany({
          where: { channelId: activeChannel.id, moderationStatus: "PUBLISHED", ...LEAD_POST_ONLY },
          orderBy: { createdAt: "desc" },
          take: POSTS_PAGE_SIZE,
          include: postCardInclude,
        })
      : Promise.resolve([]),

    !isPrivateNonMember && (isMember || isOwner)
      ? prisma.circleMembership.findMany({
          where: { circleId: circle.id },
          orderBy: { joinedAt: "asc" },
          include: { user: { select: { id: true, name: true, username: true, avatarUrl: true } } },
        })
      : Promise.resolve([]),

    // Streams started for this Circle. A PRIVATE Circle's are shown here to its members only (and nowhere else in the
    // app); a PUBLIC Circle's also appear in Home's "Live now" strip, and here for anyone who can see the Circle.
    !isPrivateNonMember
      ? prisma.liveStream.findMany({
          where: { circleId: circle.id, status: "LIVE" },
          orderBy: { startedAt: "desc" },
          take: 10,
          select: { id: true, title: true, host: { select: { name: true, username: true } } },
        })
      : Promise.resolve([]),

    // Invites waiting on the viewer's answer to a private sub-circle listed below (its button reads "Accept invite").
    // Only ones whose inviter can still invite; a private sub-circle with none is dropped from the list.
    !isPrivateNonMember
      ? loadStandingCircleInvites(
          me.id,
          circle.subCircles.filter((s) => s.visibility === "PRIVATE" && s.members.length === 0),
        )
      : Promise.resolve(new Map<string, { id: string; inviterName: string | null }>()),
  ]);
  const visibleSubCircles = isPrivateNonMember
    ? []
    : circle.subCircles.filter((s) =>
        canSeeCircle(s, { isMember: s.members.length > 0, hasStandingInvite: subCircleInvites.has(s.id) }),
      );

  // The four loads below (invite manager, polls, "Coming up", the posts' viewer state) only need what is already
  // resolved above, not one another, so they run together instead of one after another.
  //
  // The invite manager: every invite, by name, to every admin; an accepted one only while the person is still a member
  // (after leaving or being removed they're simply invitable again). Candidates are the viewer's own connections,
  // filtered exactly as inviteToCircle filters them, minus anyone with an invite already pending — except a stale one
  // (its inviter is no longer an admin, so it can't be accepted): inviting them again re-sends it from the viewer.
  const loadInviteManager = async () => {
    if (!canInvite) return { circleInvites: [], inviteCandidates: [] };
    const [invites, connections] = await Promise.all([
      loadCircleInvitesForAdmins(circle),
      getAcceptedConnectionUsers(me.id),
    ]);
    const memberIds = new Set(allMembers.map((m) => m.userId));
    const pendingIds = new Set(invites.filter((i) => i.status === "PENDING" && !i.stale).map((i) => i.inviteeId));
    const connectionIds = connections.map((u) => u.id);
    const eligible = new Set(
      eligibleCircleInvitees(
        connectionIds,
        await loadCircleInviteExclusions(circle, me.id, connectionIds, connectionIds),
      ),
    );
    return {
      circleInvites: invites.filter((i) => i.status !== "ACCEPTED" || memberIds.has(i.inviteeId)),
      inviteCandidates: connections
        .filter((u) => eligible.has(u.id) && !pendingIds.has(u.id))
        .map((u) => ({ value: u.id, label: u.name ?? dictionary.circles.voice.unknown })),
    };
  };
  // Polls: Circle-wide ones and those in channels this viewer can open (a private channel's stay with its members).
  const loadPolls = async () => {
    const pollAccess = isPrivateNonMember ? null : await getCirclePollAccess(circle, null, me);
    // circlePollWhere is shared with loadPolls (actions/polls.ts, via circlePollScope), so "Load more" and the live
    // refresh see exactly the polls this page does.
    const pollPage = pollAccess?.canView
      ? await loadPollPage(circlePollWhere(circle.id, accessibleChannels.map((c) => c.id)), me, pollAccess)
      : { polls: [], hasMore: false };
    return { pollAccess, pollPage };
  };
  // "Coming up": the upcoming events in the channels this viewer can open, under the same visibility rules as the
  // posts (circleEventsWhere, shared with "Load more" in actions/circle-events.ts).
  const loadEvents = async () =>
    isPrivateNonMember
      ? { events: [], hasMore: false }
      : loadCircleEventPage(
          await circleEventsWhere(
            circle.id,
            accessibleChannels.filter((c) => c.type === "TEXT").map((c) => c.id),
            me.id,
            new Date(),
          ),
          me.id,
        );
  const [{ circleInvites, inviteCandidates }, { pollAccess, pollPage }, eventPage, posts] = await Promise.all([
    loadInviteManager(),
    loadPolls(),
    loadEvents(),
    attachViewerState(rawPosts, me.id),
  ]);
  const postsHaveMore = rawPosts.length === POSTS_PAGE_SIZE;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      {/* Back always goes one level up, never through history (which would step through every channel visited, or land
          on the "Add a sub-circle" form the Circle was just created from): a non-default channel → this Circle's own
          page; a sub-circle → its main Circle; a main Circle → the Circles page. */}
      <BackButton href={backHref} />
      {visibleParent && (
        <p className="text-xs text-foreground-soft">
          {subCircleOfBefore}
          <Link href={`/circles/${visibleParent.slug}`} className="font-medium text-accent hover:underline">
            <bdi>{visibleParent.name}</bdi>
          </Link>
          {subCircleOfAfter}
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <p className="min-w-0 break-words text-xs font-medium uppercase tracking-wide text-teal">
          {circle.category
            .map((category) => vocabName(category, dictionary.vocab.circleCategories))
            .join(dictionary.ui.listSeparator)}
        </p>
        {circle.visibility === "PRIVATE" && (
          <span title={t.privateCircle} className="flex items-center text-foreground-soft">
            <Lock size={12} />
          </span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {circle.coverImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={circle.coverImageUrl}
              alt={circle.name}
              className="h-12 w-12 shrink-0 rounded-xl object-cover"
            />
          )}
          <h1 dir="auto" className="min-w-0 break-words text-2xl font-semibold">{circle.name}</h1>
          {canModerate && (
            <CircleDetailsEditModal
              circleId={circle.id}
              name={circle.name}
              description={circle.description}
              category={circle.category}
              categoryOptions={categoryOptions}
              visibility={circle.visibility}
              // A sub-circle under a private main Circle can't be more open than it.
              visibilityLocked={circle.parent?.visibility === "PRIVATE"}
              hasSubCircles={circle._count.subCircles > 0}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CircleMembershipButton
            circleId={circle.id}
            isMember={isMember}
            isOwner={isOwner}
            visibility={circle.visibility}
            hasPendingInvite={!!myInvite}
          />
          {(isOwner || (me.isAdmin && !isPrivateNonMember)) && (
            <DeleteCircleButton
              circleId={circle.id}
              isAdminOverride={!isOwner}
              // Deleting cascades to every sub-circle, including any private one the viewer isn't in: counted, not named.
              subCircleCount={circle._count.subCircles}
            />
          )}
        </div>
      </div>
      <p dir="auto" className="mt-2 break-words text-sm text-foreground-soft">{circle.description}</p>
      <p className="mt-1 text-xs text-foreground-soft">{plural(locale, t.members, circle._count.members)}</p>

      {isPrivateNonMember ? (
        // canSeeCircle above let a private non-member this far only with a standing invite.
        myInvite && <CircleInviteResponse inviteId={myInvite.id} inviterName={myInvite.inviterName} />
      ) : (
        <>
          {canModerate && (
            <div className="mt-4">
              <CircleCoverUpload circleId={circle.id} currentUrl={circle.coverImageUrl} />
            </div>
          )}

          {canModerate && <CircleJoinRequestManager requests={pendingJoinRequests} />}

          {canInvite && (
            <CircleInviteManager
              circleId={circle.id}
              invites={circleInvites.map((i) => ({ id: i.id, status: i.status, stale: i.stale, invitee: i.invitee }))}
              candidates={inviteCandidates}
            />
          )}

          <SubCircleList
            parentSlug={circle.slug}
            subCircles={visibleSubCircles}
            viewerId={me.id}
            pendingInviteCircleIds={visibleSubCircles.filter((s) => subCircleInvites.has(s.id)).map((s) => s.id)}
            canAdd={isOwner && !circle.parentId}
          />

          {circleLiveStreams.length > 0 && (
            <div className="mt-6 space-y-2" data-testid="circle-live-now">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-danger">
                <Radio size={14} />
                {t.liveNow}
              </h2>
              {circleLiveStreams.map((s) => (
                <Link
                  key={s.id}
                  href={`/live/${s.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-danger/40 px-4 py-3 text-sm hover:border-danger"
                >
                  <span dir="auto" className="min-w-0 truncate font-medium">{s.title}</span>
                  <span dir="auto" className="shrink-0 text-xs text-foreground-soft">{s.host.name ?? s.host.username}</span>
                </Link>
              ))}
            </div>
          )}

          <CircleEventsSection circleId={circle.id} events={eventPage.events} hasMore={eventPage.hasMore} />

          {pollAccess && (
            <PollSection
              circleId={circle.id}
              polls={pollPage.polls}
              hasMore={pollPage.hasMore}
              canCreate={pollAccess.canCreate}
              channels={accessibleChannels.filter((c) => c.type === "TEXT").map((c) => ({ id: c.id, name: c.name }))}
            />
          )}

          <div className="mt-8 grid gap-6 md:grid-cols-[64px_200px_1fr]">
            <CircleSwitcher circles={myCircles} activeCircleId={circle.id} />

            <ChannelList
              circleId={circle.id}
              circleSlug={circle.slug}
              channels={accessibleChannels}
              activeSlug={activeChannel?.slug ?? ""}
              canManage={canModerate}
            />

            <div className="min-w-0">
              {activeChannel ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h2 dir="auto" className="truncate font-semibold">#{activeChannel.name}</h2>
                      {activeChannel.topic && (
                        <p dir="auto" className="truncate text-xs text-foreground-soft">{activeChannel.topic}</p>
                      )}
                    </div>
                    {canModerate && (
                      <ChannelSettingsModal
                        channel={activeChannel}
                        circleSlug={circle.slug}
                        circleMembers={allMembers.map((m) => m.user)}
                        channelMemberIds={activeChannel.members.map((m) => m.userId)}
                      />
                    )}
                  </div>

                  {activeChannel.type === "VOICE" ? (
                    <div className="mt-4">
                      <CircleVoiceRoom
                        key={activeChannel.id}
                        channelId={activeChannel.id}
                        canJoin={isMember || isOwner}
                        circleMembers={allMembers.map((m) => m.user)}
                      />
                    </div>
                  ) : (
                    <>
                      <div className="mt-4">
                        {isMember || isOwner ? (
                          <div id="circle-composer">
                            <PostComposer circleId={circle.id} channelId={activeChannel.id} />
                          </div>
                        ) : (
                          <p className="rounded-xl border border-line p-4 text-sm text-foreground-soft">
                            {t.joinToPost}
                          </p>
                        )}
                      </div>
                      <div className="mt-6 space-y-4">
                        {posts.length === 0 && (
                          <p className="text-sm text-foreground-soft">{t.noPosts}</p>
                        )}
                        {posts.length > 0 && (
                          <CirclePostsList
                            // Remounts (fresh client state) when the active
                            // channel changes — same reasoning as Home's own
                            // PostFeedSection key (src/app/home/page.tsx).
                            key={activeChannel.id}
                            channelId={activeChannel.id}
                            initialPosts={posts}
                            initialHasMore={postsHaveMore}
                            viewerId={me.id}
                            viewerIsAdmin={me.isAdmin}
                          />
                        )}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p className="text-sm text-foreground-soft">{t.noChannels}</p>
              )}
            </div>
          </div>

          {canModerate ? (
            <div className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
                {t.membersHeading}
              </h2>
              <p className="mt-1 text-xs text-foreground-soft">{t.coAdminNote}</p>
              <div className="mt-3">
                <CircleMemberManager circleId={circle.id} members={allMembers} />
              </div>
            </div>
          ) : (
            // canModerate already covers the owner (see isCircleAdmin), so
            // this branch is reached by a plain member only.
            isMember && (
              <div className="mt-8">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-soft">
                  {t.membersHeading}
                </h2>
                <div className="mt-3">
                  <CircleMemberList members={allMembers} />
                </div>
              </div>
            )
          )}
        </>
      )}

      <CirclePostFab />
    </div>
  );
}
