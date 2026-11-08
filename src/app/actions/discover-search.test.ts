import { beforeEach, describe, expect, it, vi } from "vitest";

// searchDiscoverPeople (actions/discover.ts) against an in-memory user table: who can be found, what each row carries,
// the connection state, the page cap and the limiters.

const ME = "cme00000000001";

type Row = {
  id: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  openToIntents: string[];
  status: string;
  discoverable: boolean;
  isAdmin: boolean;
  isGuestPreview: boolean;
  emailVerified: Date | null;
  phoneVerifiedAt: Date | null;
  trustScore: number;
  email: string;
  phone: string | null;
  birthDate: Date | null;
  bio: string | null;
};

function person(id: string, over: Partial<Row> = {}): Row {
  return {
    id,
    name: `Ada ${id}`,
    username: `ada_${id}`,
    avatarUrl: `/api/avatar/${id}/x-t.jpg`,
    openToIntents: ["FRIENDSHIP"],
    status: "ACTIVE",
    discoverable: true,
    isAdmin: false,
    isGuestPreview: false,
    emailVerified: new Date("2026-01-01"),
    phoneVerifiedAt: null,
    trustScore: 0,
    email: `${id}@example.com`,
    phone: "+15550000000",
    birthDate: new Date("2000-01-01"),
    bio: "secret bio",
    ...over,
  };
}

let users: Row[] = [];
let blocked = new Set<string>();
let connections: Array<{ id: string; status: string; requesterId: string; targetId: string }> = [];
let conversations: Array<{ id: string; isGroup: boolean; members: Array<{ userId: string }> }> = [];
const limits: Record<string, boolean> = {};
const checkRateLimit = vi.fn(async (name: string) => limits[name] ?? true);
let verified = true;

vi.mock("@/lib/auth-guards", () => ({
  requireVerifiedUser: async () => {
    if (!verified) throw new Error("Verify your account to use this feature.");
    return { id: ME, isGuestPreview: false };
  },
  requireViewer: async () => ({ id: ME, isGuestPreview: false }),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (name: string) => checkRateLimit(name) }));
vi.mock("@/lib/blocks", () => ({ getBlockedEitherWayIds: async () => new Set(blocked) }));
vi.mock("@/lib/connections", () => ({ getConnectedOrPendingIds: async () => new Set() }));

type Where = Record<string, unknown>;
function containsInsensitive(value: string | null, needle: string) {
  return value !== null && value.toLowerCase().includes(needle.toLowerCase());
}
function matches(u: Row, where: Where): boolean {
  const w = where as {
    id: { notIn: string[] };
    status: string;
    name: { not: null };
    discoverable: boolean;
    isAdmin: boolean;
    isGuestPreview: boolean;
    NOT: { emailVerified: null; phoneVerifiedAt: null };
    OR: Array<{ name?: { contains: string }; username?: { contains: string } }>;
  };
  if (w.id.notIn.includes(u.id)) return false;
  if (u.status !== w.status || u.name === null || u.discoverable !== w.discoverable) return false;
  if (u.isAdmin !== w.isAdmin || u.isGuestPreview !== w.isGuestPreview) return false;
  if (u.emailVerified === null && u.phoneVerifiedAt === null) return false;
  return w.OR.some((c) =>
    c.name ? containsInsensitive(u.name, c.name.contains) : containsInsensitive(u.username, c.username!.contains),
  );
}
function pick<T extends object>(row: T, select: Record<string, boolean>) {
  return Object.fromEntries(Object.keys(select).map((k) => [k, (row as Record<string, unknown>)[k]]));
}

const userFindMany = vi.fn(
  async (args: { where: Where; orderBy: unknown; skip: number; take: number; select: Record<string, boolean> }) =>
    users
      .filter((u) => matches(u, args.where))
      .sort((a, b) => b.trustScore - a.trustScore || a.id.localeCompare(b.id))
      .slice(args.skip, args.skip + args.take)
      .map((u) => pick(u, args.select)),
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: (args: never) => userFindMany(args) },
    connection: {
      findMany: async (args: { where: { OR: Array<{ requesterId: string | { in: string[] }; targetId: string | { in: string[] } }> } }) => {
        const [mine, theirs] = args.where.OR as [
          { requesterId: string; targetId: { in: string[] } },
          { targetId: string; requesterId: { in: string[] } },
        ];
        return connections.filter(
          (c) =>
            (c.requesterId === mine.requesterId && mine.targetId.in.includes(c.targetId)) ||
            (c.targetId === theirs.targetId && theirs.requesterId.in.includes(c.requesterId)),
        );
      },
    },
    conversation: {
      findMany: async (args: { where: { isGroup: boolean; AND: [unknown, { members: { some: { userId: { in: string[] } } } }] } }) => {
        const ids = args.where.AND[1].members.some.userId.in;
        return conversations.filter(
          (c) =>
            c.isGroup === args.where.isGroup &&
            c.members.some((m) => m.userId === ME) &&
            c.members.some((m) => ids.includes(m.userId)),
        );
      },
    },
  },
}));

const { searchDiscoverPeople } = await import("@/app/actions/discover");

beforeEach(() => {
  users = [];
  blocked = new Set();
  connections = [];
  conversations = [];
  verified = true;
  for (const key of Object.keys(limits)) delete limits[key];
  checkRateLimit.mockClear();
  userFindMany.mockClear();
});

describe("searchDiscoverPeople: who can be found", () => {
  it("finds by display name or username, case-insensitively", async () => {
    users = [
      person("c1", { name: "Grace Hopper", username: "amazing_grace" }),
      person("c2", { name: "Ada Lovelace", username: "countess" }),
      person("c3", { name: "Someone", username: "GRACEFUL" }),
    ];
    const result = await searchDiscoverPeople("grace", 1);
    expect(result.items.map((i) => i.person.id).sort()).toEqual(["c1", "c3"]);
  });

  it("does not search the bio or anything private", async () => {
    users = [person("c1", { name: "Bob", username: "bob1", bio: "zebra lover", email: "zebra@example.com" })];
    expect((await searchDiscoverPeople("zebra", 1)).items).toEqual([]);
  });

  it("leaves out blocked (either way), inactive, opted-out, unverified, admin, guest and unnamed accounts", async () => {
    users = [
      person("ok1"),
      person("blk"),
      person("sus", { status: "SUSPENDED" }),
      person("ban", { status: "BANNED" }),
      person("del", { status: "DELETED" }),
      person("dea", { status: "DEACTIVATED" }),
      person("opt", { discoverable: false }),
      person("unv", { emailVerified: null, phoneVerifiedAt: null }),
      person("pho", { emailVerified: null, phoneVerifiedAt: new Date() }),
      person("adm", { isAdmin: true }),
      person("gst", { isGuestPreview: true }),
      person("nam", { name: null, username: "ada_nam" }),
      person(ME, { name: "Ada me" }),
    ];
    blocked = new Set(["blk"]);
    const result = await searchDiscoverPeople("ada", 1);
    expect(result.items.map((i) => i.person.id).sort()).toEqual(["ok1", "pho"]);
  });

  it("sends only what the row renders: never email, phone, birth date, bio or flags", async () => {
    users = [person("c1")];
    const [item] = (await searchDiscoverPeople("ada", 1)).items;
    expect(Object.keys(item.person).sort()).toEqual(["avatarUrl", "id", "name", "openToIntents", "username"]);
    expect(JSON.stringify(item)).not.toMatch(/example\.com|\+1555|2000-01-01|secret bio/);
  });

  it("answers an exact username exactly like a partial match (no exact-match-only path)", async () => {
    users = [person("c1", { username: "zed", name: "Zed", discoverable: false })];
    expect((await searchDiscoverPeople("zed", 1)).items).toEqual([]);
    expect((await searchDiscoverPeople("@zed", 1)).items).toEqual([]);
  });
});

describe("searchDiscoverPeople: query, paging and limits", () => {
  it("doesn't touch the database or the limiter for a too-short query or an out-of-range page", async () => {
    users = [person("c1")];
    expect(await searchDiscoverPeople("a", 1)).toEqual({ error: null, items: [], hasMore: false });
    expect(await searchDiscoverPeople("%%", 1)).toEqual({ error: null, items: [], hasMore: false });
    expect(await searchDiscoverPeople("ada", 0)).toEqual({ error: null, items: [], hasMore: false });
    expect(await searchDiscoverPeople("ada", 4)).toEqual({ error: null, items: [], hasMore: false });
    expect(userFindMany).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("pages 20 at a time and stops at 60 however many match", async () => {
    users = Array.from({ length: 100 }, (_, i) => person(`c${String(i).padStart(3, "0")}`));
    const p1 = await searchDiscoverPeople("ada", 1);
    const p2 = await searchDiscoverPeople("ada", 2);
    const p3 = await searchDiscoverPeople("ada", 3);
    expect([p1.items.length, p2.items.length, p3.items.length]).toEqual([20, 20, 20]);
    expect([p1.hasMore, p2.hasMore, p3.hasMore]).toEqual([true, true, false]);
    const ids = [...p1.items, ...p2.items, ...p3.items].map((i) => i.person.id);
    expect(new Set(ids).size).toBe(60);
    expect(userFindMany.mock.calls[2][0].take).toBe(20);
  });

  it("says there is no next page when the matches run out", async () => {
    users = Array.from({ length: 21 }, (_, i) => person(`c${i}`));
    expect((await searchDiscoverPeople("ada", 1)).hasMore).toBe(true);
    expect((await searchDiscoverPeople("ada", 2))).toMatchObject({ hasMore: false, items: [expect.anything()] });
  });

  it("answers rate_limited, with nothing, when either limiter refuses", async () => {
    users = [person("c1")];
    limits.discoverSearch = false;
    expect(await searchDiscoverPeople("ada", 1)).toEqual({ error: "rate_limited", items: [], hasMore: false });
    limits.discoverSearch = true;
    limits.discoverSearchHour = false;
    expect(await searchDiscoverPeople("ada", 1)).toEqual({ error: "rate_limited", items: [], hasMore: false });
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it("is refused for an unverified account", async () => {
    verified = false;
    await expect(searchDiscoverPeople("ada", 1)).rejects.toThrow();
  });
});

describe("searchDiscoverPeople: connection state", () => {
  it("shows none / requested / incoming / connected, and a declined request as none", async () => {
    users = [person("cn"), person("cr"), person("ci"), person("cc"), person("cd")];
    connections = [
      { id: "k1", status: "PENDING", requesterId: ME, targetId: "cr" },
      { id: "k2", status: "PENDING", requesterId: "ci", targetId: ME },
      { id: "k3", status: "ACCEPTED", requesterId: "cc", targetId: ME },
      { id: "k4", status: "DECLINED", requesterId: ME, targetId: "cd" },
      // Someone else's request to "cn" says nothing about the viewer.
      { id: "k5", status: "ACCEPTED", requesterId: "cx", targetId: "cn" },
    ];
    conversations = [
      { id: "dm1", isGroup: false, members: [{ userId: ME }, { userId: "cc" }] },
      { id: "grp", isGroup: true, members: [{ userId: ME }, { userId: "cc" }, { userId: "cn" }] },
    ];
    const byId = new Map((await searchDiscoverPeople("ada", 1)).items.map((i) => [i.person.id, i]));
    expect(byId.get("cn")).toMatchObject({ state: "none", connectionId: null, conversationId: null });
    expect(byId.get("cr")).toMatchObject({ state: "requested", connectionId: null, conversationId: null });
    expect(byId.get("ci")).toMatchObject({ state: "incoming", connectionId: "k2", conversationId: null });
    expect(byId.get("cc")).toMatchObject({ state: "connected", connectionId: null, conversationId: "dm1" });
    expect(byId.get("cd")).toMatchObject({ state: "none", connectionId: null });
  });

  it("an accepted row wins over an older declined one in the other direction", async () => {
    users = [person("c1")];
    connections = [
      { id: "old", status: "DECLINED", requesterId: "c1", targetId: ME },
      { id: "new", status: "ACCEPTED", requesterId: ME, targetId: "c1" },
    ];
    expect((await searchDiscoverPeople("ada", 1)).items[0].state).toBe("connected");
  });
});
