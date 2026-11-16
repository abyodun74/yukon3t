import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

// Every surface that shows a person's Message button gets "the DM with them" from findDirectConversationIds
// (lib/direct-conversation.ts): Discover (page + load more), People you may know, Discover search, the Connections list
// (and its activity order), the Connect popover's engagement status, and startDirectMessage. Here each runs against an
// in-memory database where the viewer shares a GROUP chat with the person: the 1:1 id is returned when there is one,
// nothing (so the button starts a 1:1) when there isn't, with one conversation query per page.

const ME = "cme00000000001";

type Conv = { id: string; isGroup: boolean; createdAt: Date; members: string[] };
type Connection = { id: string; status: string; requesterId: string; targetId: string; intentTag: string; respondedAt: Date | null; createdAt: Date };

let conversations: Conv[] = [];
let connections: Connection[] = [];
let users: Array<{ id: string; name: string; status: string; isAdmin: boolean; isGuestPreview: boolean; isAppReviewDemo: boolean; openToIntents: string[] }> = [];
let hiddenPeers: string[] = [];
let latest = new Map<string, Date>();

type UserIdCond = string | { in: string[] };
type Part = { members?: { some?: { userId: UserIdCond }; every?: { userId: UserIdCond } }; NOT?: unknown };
type ConvArgs = { where: { isGroup?: boolean; AND?: Part[] }; orderBy?: unknown };
const idMatches = (cond: UserIdCond, userId: string) => (typeof cond === "string" ? cond === userId : cond.in.includes(userId));

const conversationFindMany = vi.fn(async (args: ConvArgs) =>
  conversations
    .filter((c) => {
      if (args.where.isGroup !== undefined && c.isGroup !== args.where.isGroup) return false;
      return (args.where.AND ?? []).every(
        (p) =>
          (!p.members?.some || c.members.some((u) => idMatches(p.members!.some!.userId, u))) &&
          (!p.members?.every || c.members.every((u) => idMatches(p.members!.every!.userId, u))),
      );
    })
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .map((c) => ({ id: c.id, members: c.members.map((userId) => ({ userId })) })),
);
const conversationCreate = vi.fn(async (args: { data: { members: { create: { userId: string }[] } } }) => {
  const row: Conv = { id: `new-${conversations.length}`, isGroup: false, createdAt: new Date(), members: args.data.members.create.map((m) => m.userId) };
  conversations.push(row);
  return { id: row.id };
});

/** connection.findMany: the pair-lookup shapes these surfaces use (OR of requester/target, with `in` or a plain id). */
function connectionMatches(c: Connection, where: Record<string, unknown>): boolean {
  if (where.id && typeof where.id === "object" && "in" in (where.id as object)) return (where.id as { in: string[] }).in.includes(c.id);
  if (where.status && c.status !== where.status) return false;
  const or = (where.OR ?? []) as Array<{ requesterId?: UserIdCond; targetId?: UserIdCond }>;
  return or.some(
    (o) => (o.requesterId === undefined || idMatches(o.requesterId, c.requesterId)) && (o.targetId === undefined || idMatches(o.targetId, c.targetId)),
  );
}
const profile = (id: string) => ({ id, name: `N ${id}`, username: id, avatarUrl: null, trustBand: "NEW", lastSeenAt: null });

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/auth-guards", () => ({
  requireUser: async () => ({ id: ME, isAppReviewDemo: false }),
  requireVerifiedUser: async () => ({ id: ME, name: "Me", isAppReviewDemo: false, isGuestPreview: false }),
  requireViewer: async () => ({ id: ME, isGuestPreview: false }),
}));
vi.mock("@/lib/page-guards", () => ({ getOnboardedUserOrRedirect: async () => ({ id: ME, isGuestPreview: false }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/blocks", () => ({
  isBlockedEitherWay: async () => false,
  getBlockedEitherWayIds: async () => new Set<string>(),
}));
vi.mock("@/lib/connections", () => ({ getConnectedOrPendingIds: async () => new Set<string>() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/notify-push", () => ({ pushActivityNotification: vi.fn() }));
vi.mock("@/lib/realtime-server", () => ({ notifyBadgeChange: vi.fn() }));
vi.mock("@/lib/hidden-chats", () => ({ getHiddenPeerIds: async () => hiddenPeers }));
vi.mock("@/lib/latest-messages", () => ({
  latestMessageAtByConversation: async (ids: string[]) => new Map(ids.filter((id) => latest.has(id)).map((id) => [id, latest.get(id)!])),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findMany: (a: ConvArgs) => conversationFindMany(a), create: (a: never) => conversationCreate(a) },
    connection: {
      findMany: async (args: { where: Record<string, unknown>; include?: unknown }) =>
        connections
          .filter((c) => connectionMatches(c, args.where))
          .map((c) => (args.include ? { ...c, requester: profile(c.requesterId), target: profile(c.targetId) } : c)),
      findFirst: async (args: { where: Record<string, unknown> }) => connections.find((c) => connectionMatches(c, args.where)) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) => connections.find((c) => c.id === where.id) ?? null,
      create: async () => ({ id: "k-new" }),
      update: async ({ where, data }: { where: { id: string }; data: { status?: string } }) => ({
        ...connections.find((c) => c.id === where.id)!,
        ...data,
      }),
    },
    subscription: { findMany: async () => [], createMany: async () => ({ count: 0 }) },
    notification: { create: async () => ({}) },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => users.find((u) => u.id === where.id) ?? null,
      findMany: async () => users.map((u) => ({ ...profile(u.id), country: null, bio: null, openToIntents: u.openToIntents })),
    },
  },
}));

// The Discover page's own children: plain stand-ins whose props are read back from the returned tree.
const DiscoverPeopleList = vi.fn(() => null);
const PeopleYouMayKnow = vi.fn(() => null);
vi.mock("@/components/discover-people-list", () => ({ DiscoverPeopleList }));
vi.mock("@/components/people-you-may-know", () => ({ PeopleYouMayKnow }));
vi.mock("@/components/discover-people-search", () => ({ DiscoverPeopleSearch: () => null }));
vi.mock("@/components/back-button", () => ({ BackButton: () => null }));
const mayKnow: Array<{ person: { id: string }; mutualCount: number }> = [];
vi.mock("@/app/actions/discover", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/actions/discover")>()),
  getPeopleYouMayKnow: async () => mayKnow,
}));
const words: unknown = new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : words) });
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en", getDictionary: async () => words }));

const { loadMoreDiscoverPeople, searchDiscoverPeople } = await import("@/app/actions/discover");
const { getInitialAcceptedConnections, loadMoreAcceptedConnections, startDirectMessage, respondToConnection } = await import(
  "@/app/actions/connections"
);
const { getAuthorEngagementStatus } = await import("@/lib/engagement-status");
const { default: DiscoverPage } = await import("@/app/discover/page");

const at = (day: number) => new Date(Date.UTC(2026, 0, day));
const accepted = (id: string, other: string): Connection => ({
  id,
  status: "ACCEPTED",
  requesterId: ME,
  targetId: other,
  intentTag: "FRIENDSHIP",
  respondedAt: at(1),
  createdAt: at(1),
});
const person = (id: string) => ({ id, name: `N ${id}`, status: "ACTIVE", isAdmin: false, isGuestPreview: false, isAppReviewDemo: false, openToIntents: ["FRIENDSHIP"] });

/** Every element of a returned JSX tree whose type is `type`. */
function findElements(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((n) => findElements(n, type));
  const el = node as ReactElement<{ children?: ReactNode }> & { $$typeof?: unknown };
  if (typeof el.$$typeof !== "symbol") return [];
  return [...(el.type === type ? [el as ReactElement<Record<string, unknown>>] : []), ...findElements(el.props?.children, type)];
}

beforeEach(() => {
  // ca: a 1:1 plus an older shared group. cb: only a shared group. cc: nothing at all.
  conversations = [
    { id: "grp-ab", isGroup: true, createdAt: at(1), members: [ME, "ca", "cb"] },
    { id: "dm-a", isGroup: false, createdAt: at(4), members: [ME, "ca"] },
    { id: "grp-b-two", isGroup: true, createdAt: at(2), members: [ME, "cb"] },
  ];
  connections = [accepted("k-a", "ca"), accepted("k-b", "cb"), accepted("k-c", "cc")];
  users = [person("ca"), person("cb"), person("cc")];
  hiddenPeers = [];
  latest = new Map();
  mayKnow.length = 0;
  conversationFindMany.mockClear();
  conversationCreate.mockClear();
  DiscoverPeopleList.mockClear();
  PeopleYouMayKnow.mockClear();
});

const ids = (items: Array<{ conversationId: string | null }>, key: (i: never) => string) =>
  Object.fromEntries(items.map((i) => [key(i as never), i.conversationId]));

describe("Discover", () => {
  it("load more: the 1:1 for ca, nothing (not the group) for cb, one conversation query", async () => {
    const { items } = await loadMoreDiscoverPeople("2", {});
    expect(ids(items, (i: { person: { id: string } }) => i.person.id)).toEqual({ ca: "dm-a", cb: null, cc: null });
    expect(conversationFindMany).toHaveBeenCalledTimes(1);
  });

  it("people search: same answer for connected people", async () => {
    const { items } = await searchDiscoverPeople("nam", 1);
    expect(ids(items, (i: { person: { id: string } }) => i.person.id)).toEqual({ ca: "dm-a", cb: null, cc: null });
    expect(conversationFindMany).toHaveBeenCalledTimes(1);
  });

  it("the page: People you may know and the grid both get the 1:1 only, one query each", async () => {
    mayKnow.push({ person: { id: "ca" }, mutualCount: 2 }, { person: { id: "cb" }, mutualCount: 1 });
    const tree = await DiscoverPage({ searchParams: Promise.resolve({}) });
    const [pymk] = findElements(tree, PeopleYouMayKnow);
    const [grid] = findElements(tree, DiscoverPeopleList);
    expect(ids(pymk.props.items as never, (i: { person: { id: string } }) => i.person.id)).toEqual({ ca: "dm-a", cb: null });
    expect(ids(grid.props.initialItems as never, (i: { person: { id: string } }) => i.person.id)).toEqual({
      ca: "dm-a",
      cb: null,
      cc: null,
    });
    expect(conversationFindMany).toHaveBeenCalledTimes(2);
  });
});

describe("Connections", () => {
  it("the Connected list (first page and load more) carries the 1:1 only", async () => {
    const first = await getInitialAcceptedConnections();
    expect(ids(first.items, (i: { other: { id: string } }) => i.other.id)).toEqual({ ca: "dm-a", cb: null, cc: null });
    // One query for the activity order, one for the page.
    expect(conversationFindMany).toHaveBeenCalledTimes(2);
    const more = await loadMoreAcceptedConnections("nope");
    expect(ids(more.items, (i: { other: { id: string } }) => i.other.id)).toEqual({ ca: "dm-a", cb: null, cc: null });
  });

  it("orders by the 1:1's activity, never a shared group's", async () => {
    latest = new Map([
      ["grp-ab", at(30)], // newest, but a group: must not lift ca or cb
      ["dm-a", at(10)],
    ]);
    connections = [
      { ...accepted("k-a", "ca"), respondedAt: at(2) },
      { ...accepted("k-b", "cb"), respondedAt: at(20) },
      { ...accepted("k-c", "cc"), respondedAt: at(5) },
    ];
    const { items } = await getInitialAcceptedConnections();
    expect(items.map((i) => i.other.id)).toEqual(["cb", "ca", "cc"]);
  });

  it("still leaves a PIN-hidden peer out of the list", async () => {
    hiddenPeers = ["ca"];
    const { items } = await getInitialAcceptedConnections();
    expect(items.map((i) => i.other.id).sort()).toEqual(["cb", "cc"]);
  });

  it("startDirectMessage opens the 1:1 when there is one, and starts one (not the group) when there isn't", async () => {
    expect(await startDirectMessage("ca")).toEqual({ error: null, conversationId: "dm-a" });
    expect(conversationCreate).not.toHaveBeenCalled();
    const started = await startDirectMessage("cb");
    expect(started.conversationId).not.toMatch(/^grp/);
    expect(conversationCreate).toHaveBeenCalledTimes(1);
    expect(conversationCreate.mock.calls[0][0].data.members.create).toEqual([{ userId: ME }, { userId: "cb" }]);
    // And from then on every surface finds that new 1:1.
    expect((await loadMoreDiscoverPeople("2", {})).items.find((i) => i.person.id === "cb")?.conversationId).toBe(
      started.conversationId,
    );
  });

  it("accepting a request reuses the existing 1:1, and creates one rather than reusing a shared group", async () => {
    connections = [
      { ...accepted("k-a", "ca"), status: "PENDING", requesterId: "ca", targetId: ME },
      { ...accepted("k-b", "cb"), status: "PENDING", requesterId: "cb", targetId: ME },
    ];
    expect(await respondToConnection("k-a", true)).toMatchObject({ conversationId: "dm-a" });
    const b = await respondToConnection("k-b", true);
    expect(b.conversationId).not.toMatch(/^grp/);
    expect(conversationCreate).toHaveBeenCalledTimes(1);
  });
});

describe("Connect popover (engagement status)", () => {
  it("links to the 1:1 only, one query for every author on the page", async () => {
    const map = await getAuthorEngagementStatus(ME, ["ca", "cb", "cc", "ca"]);
    expect(map.get("ca")?.conversationId).toBe("dm-a");
    expect(map.get("cb")?.conversationId).toBeNull();
    expect(map.get("cc")?.conversationId).toBeNull();
    expect(conversationFindMany).toHaveBeenCalledTimes(1);
  });
});
