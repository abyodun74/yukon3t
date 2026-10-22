import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

// public/sw.js is plain JavaScript served as-is, so it is loaded here into a sandbox with a fake `self` and its
// "push" / "notificationclick" listeners are driven directly.
const ORIGIN = "https://yukon3t.com";
const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

type FakeClient = {
  url: string;
  focused: boolean;
  focus: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
};

function load(windows: FakeClient[] = []) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const openWindow = vi.fn().mockResolvedValue(null);
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (name: string, fn: (event: unknown) => void) => {
      listeners[name] = fn;
    },
    skipWaiting: () => {},
    registration: { showNotification },
    clients: { matchAll: vi.fn().mockResolvedValue(windows), openWindow, claim: () => {} },
  };
  runInNewContext(source, { self, URL, caches: {}, fetch, Response, console });

  async function click(url: unknown) {
    let done: Promise<unknown> = Promise.resolve();
    listeners.notificationclick({
      notification: { data: { url }, close: () => {} },
      waitUntil: (p: Promise<unknown>) => {
        done = p;
      },
    });
    await done;
  }
  async function push(payload: unknown) {
    let done: Promise<unknown> = Promise.resolve();
    listeners.push({
      data: { json: () => payload, text: () => "" },
      waitUntil: (p: Promise<unknown>) => {
        done = p;
      },
    });
    await done;
  }
  return { click, push, openWindow, showNotification };
}

function client(url: string, focused = false): FakeClient {
  const c: FakeClient = {
    url,
    focused,
    focus: vi.fn(),
    navigate: vi.fn(),
  };
  c.focus.mockResolvedValue(c);
  c.navigate.mockResolvedValue(c);
  return c;
}

describe("service worker notification click", () => {
  it("opens the exact target when no app window is open", async () => {
    const sw = load();
    await sw.click("/u/me?story=s1");
    expect(sw.openWindow).toHaveBeenCalledWith(`${ORIGIN}/u/me?story=s1`);
  });

  it("focuses an open app window and navigates it to the target, rather than opening another", async () => {
    const home = client(`${ORIGIN}/home`, true);
    const sw = load([home]);
    await sw.click("/messages/c1");
    expect(home.focus).toHaveBeenCalled();
    expect(home.navigate).toHaveBeenCalledWith(`${ORIGIN}/messages/c1`);
    expect(sw.openWindow).not.toHaveBeenCalled();
  });

  it("only focuses a window already on that exact URL, query included", async () => {
    const profile = client(`${ORIGIN}/u/me`);
    const story = client(`${ORIGIN}/u/me?story=s1`);
    const sw = load([profile, story]);
    await sw.click("/u/me?story=s1");
    expect(story.focus).toHaveBeenCalled();
    expect(story.navigate).not.toHaveBeenCalled();
    expect(profile.navigate).not.toHaveBeenCalled();
  });

  it("opens a window when the open one can't be navigated (not controlled by this worker)", async () => {
    const stale = client(`${ORIGIN}/home`);
    stale.navigate.mockRejectedValue(new TypeError("not controlled"));
    const sw = load([stale]);
    await sw.click("/post/p1");
    expect(sw.openWindow).toHaveBeenCalledWith(`${ORIGIN}/post/p1`);
  });

  it("never leaves the site, whatever the payload says", async () => {
    for (const url of ["https://evil.example/x", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", 5]) {
      const sw = load();
      await sw.click(url);
      expect(sw.openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
    }
  });

  it("ignores windows of other origins", async () => {
    const other = client("https://other.example/home", true);
    const sw = load([other]);
    await sw.click("/post/p1");
    expect(other.navigate).not.toHaveBeenCalled();
    expect(sw.openWindow).toHaveBeenCalledWith(`${ORIGIN}/post/p1`);
  });

  it("stores the push payload's target on the notification it shows", async () => {
    const sw = load();
    await sw.push({ title: "Ada", body: "liked your post", url: "/post/p1" });
    expect(sw.showNotification.mock.calls[0][1].data).toEqual({ url: `${ORIGIN}/post/p1` });
  });
});
