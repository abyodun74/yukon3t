import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Settings -> Privacy "Allow others to repost my Stories" (User.allowStoryReposts, on by default): saved by
// updatePrivacy with the rest of the privacy form, enforced by actions/story-reshare.ts (story-reshare.test.ts).

const ME = "cme00000000001";
let me: { id: string; isAdmin: boolean };
const userUpdate = vi.fn();

class Redirect extends Error {}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { update: (a: unknown) => userUpdate(a) } } }));
vi.mock("@/lib/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/auth-guards", () => ({
  requireUser: async () => me,
  getPasswordHash: vi.fn(),
  isPasswordResetRequired: vi.fn(),
}));
vi.mock("@/lib/account-reauth", () => ({ verifyAccountReauth: async () => ({ ok: true }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/hidden-chats", () => ({ getHiddenState: vi.fn(), isHiddenUnlocked: vi.fn() }));
vi.mock("@/lib/avatar-storage", () => ({ absoluteAvatarUrl: (u: string | null) => u }));
vi.mock("@/lib/ambient-access", () => ({ activeWidgetTokensOf: vi.fn() }));
vi.mock("@/lib/passwords", () => ({ hashPassword: vi.fn(), verifyPassword: vi.fn() }));
vi.mock("@/lib/trust", () => ({ recomputeTrustScore: vi.fn() }));
vi.mock("@/lib/moderation", () => ({ moderateText: vi.fn() }));
vi.mock("@/lib/embeddings", () => ({ updateUserEmbedding: vi.fn() }));
vi.mock("@/lib/device-id", () => ({ getDeviceId: vi.fn(), getDeviceLabel: vi.fn() }));
vi.mock("@/lib/device-trust", () => ({ evaluateDevice: vi.fn(), trustDevice: vi.fn(), touchKnownDevice: vi.fn() }));
vi.mock("@/lib/device-challenge", () => ({ createDeviceChallenge: vi.fn(), verifyDeviceChallenge: vi.fn() }));
vi.mock("@/lib/client-ip", () => ({ getClientIp: async () => "203.0.113.1" }));
vi.mock("@/lib/bot-gate", () => ({ passesBotGate: async () => ({ ok: true }) }));
vi.mock("@/lib/account-media", () => ({ collectAccountMedia: vi.fn(), deleteAccountMedia: vi.fn() }));

const { updatePrivacy } = await import("./profile");

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function save(fd: FormData) {
  try {
    await updatePrivacy(fd);
  } catch (err) {
    if (err instanceof Redirect) return err.message;
    throw err;
  }
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  me = { id: ME, isAdmin: false };
});

describe("updatePrivacy: Allow others to repost my Stories", () => {
  it("saves the ticked box as on", async () => {
    expect(await save(form({ postsVisibility: "PUBLIC", discoverable: "on", allowStoryReposts: "on" }))).toBe(
      "/settings?saved=1",
    );
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: ME },
      data: { postsVisibility: "PUBLIC", discoverable: true, allowStoryReposts: true },
    });
  });

  it("saves an unticked box (absent from the form) as the opt-out", async () => {
    await save(form({ postsVisibility: "CONNECTIONS_ONLY" }));
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: ME },
      data: { postsVisibility: "CONNECTIONS_ONLY", discoverable: false, allowStoryReposts: false },
    });
  });

  it("is a checkbox in the privacy form, ticked from the account's value", () => {
    const page = readFileSync("src/app/settings/page.tsx", "utf8");
    expect(page).toContain('name="allowStoryReposts"');
    expect(page).toContain("defaultChecked={user.allowStoryReposts}");
    expect(page).toContain("t.privacy.allowStoryRepostsHint");
  });

  it("is on by default for every account, existing ones included", () => {
    expect(readFileSync("prisma/schema.prisma", "utf8")).toContain("allowStoryReposts Boolean @default(true)");
    expect(readFileSync("prisma/migrations/20261127120100_story_reshare/migration.sql", "utf8")).toContain(
      'ADD COLUMN     "allowStoryReposts" BOOLEAN NOT NULL DEFAULT true',
    );
  });
});
