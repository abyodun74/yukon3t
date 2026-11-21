import { beforeEach, describe, expect, it, vi } from "vitest";

// /api/badge-counts: the bell counts only the caller's unread, visible rows, so a row marked read (by viewing its story,
// opening its chat, tapping it) stops counting on the next refetch; the Messages tab is countConversationsWithUnread.

const ME = "cme00000000001";
const user = { id: ME, locale: "en", isGuestPreview: false, lastSeenAnnouncementAt: null };

type Row = { recipientId: string; readAt: Date | null };
let rows: Row[] = [];
const countWhere = vi.fn();
const VISIBLE = { __visible: true };
const CIRCLE = { __circle: true };
const COLLAB = { __collab: true };

vi.mock("@/lib/auth-guards", () => ({
  requireViewer: async () => user,
  AuthError: class AuthError extends Error {},
}));
vi.mock("@/lib/hidden-chats", () => ({ getHiddenState: async () => ({ peerIds: [], conversationIds: [] }) }));
vi.mock("@/lib/hidden-chats-rules", () => ({ visibleNotificationWhere: () => [VISIBLE] }));
vi.mock("@/lib/circle-visibility", () => ({ circleNotificationVisibleWhere: () => CIRCLE }));
vi.mock("@/lib/collab-visibility", () => ({ collabNotificationVisibleWhere: () => COLLAB }));
vi.mock("@/lib/user-locale", () => ({ rememberLocale: async () => {} }));
vi.mock("@/lib/latest-messages", () => ({ countConversationsWithUnread: async () => 2 }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    connection: { count: async () => 0 },
    notification: {
      count: async (args: { where: { recipientId: string; readAt: null } }) => {
        countWhere(args.where);
        return rows.filter((r) => r.recipientId === args.where.recipientId && r.readAt === args.where.readAt).length;
      },
    },
    announcement: { findFirst: async () => null },
  },
}));

const { GET } = await import("@/app/api/badge-counts/route");

beforeEach(() => {
  vi.clearAllMocks();
  rows = [
    { recipientId: ME, readAt: null },
    { recipientId: ME, readAt: null },
    { recipientId: ME, readAt: new Date("2026-11-20T10:00:00Z") },
    { recipientId: "cother00000001", readAt: null },
  ];
});

describe("/api/badge-counts", () => {
  it("counts only the caller's unread rows, through the same visibility filters as the list", async () => {
    const body = await (await GET()).json();
    expect(body.unreadNotifications).toBe(2);
    expect(body.unreadMessages).toBe(2);
    expect(countWhere).toHaveBeenCalledWith({ recipientId: ME, readAt: null, AND: [VISIBLE, CIRCLE, COLLAB] });
  });

  it("drops as soon as a row is marked read", async () => {
    rows[0].readAt = new Date();
    expect((await (await GET()).json()).unreadNotifications).toBe(1);
    rows[1].readAt = new Date();
    expect((await (await GET()).json()).unreadNotifications).toBe(0);
  });
});
