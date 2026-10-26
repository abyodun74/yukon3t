import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

// The caching half of public/sw.js, driven the same way as service-worker-notification.test.ts: the plain-JS file is
// loaded into a sandbox with a fake `self` and an in-memory Cache Storage, and its "fetch" listener is called directly.
const ORIGIN = "https://yukon3t.com";
const source = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      put: async (req: Request, res: Response) => void store.set(req.url, res),
      keys: async () => [...store.keys()].map((url) => new Request(url)),
      delete: async (req: Request) => store.delete(req.url),
      addAll: async (urls: string[]) => urls.forEach((u) => store.set(new URL(u, ORIGIN).href, new Response(u))),
    };
  };
  const match = async (req: Request | string) => {
    const url = typeof req === "string" ? new URL(req, ORIGIN).href : req.url;
    for (const store of stores.values()) if (store.has(url)) return store.get(url)!.clone();
    return undefined;
  };
  return { stores, api: { open, match, keys: async () => [...stores.keys()], delete: async (n: string) => stores.delete(n) } };
}

function load(fetchImpl: (req: Request) => Promise<Response>) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const caches = fakeCaches();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (name: string, fn: (event: unknown) => void) => {
      listeners[name] = fn;
    },
    skipWaiting: () => {},
    registration: { showNotification: vi.fn() },
    clients: { claim: () => {} },
  };
  runInNewContext(source, { self, URL, caches: caches.api, fetch: fetchImpl, Response, Request, console, Promise });

  async function dispatch(url: string, { method = "GET", mode = "cors" }: { method?: string; mode?: string } = {}) {
    const request = Object.assign(new Request(new URL(url, ORIGIN).href, { method }), {});
    Object.defineProperty(request, "mode", { value: mode });
    let responded: Promise<Response> | null = null;
    const waits: Promise<unknown>[] = [];
    listeners.fetch({
      request,
      respondWith: (p: Promise<Response>) => {
        responded = p;
      },
      waitUntil: (p: Promise<unknown>) => void waits.push(p),
    });
    const response = responded ? await responded : null;
    await Promise.all(waits);
    return response as Response | null;
  }
  return { dispatch, caches };
}

describe("service worker caching", () => {
  it("leaves API, avatar, auth, write and cross-origin requests to the network untouched", async () => {
    const fetchImpl = vi.fn(async () => new Response("net"));
    const { dispatch } = load(fetchImpl);
    for (const url of ["/api/badge-counts", "/api/avatar/u1/a-t.jpg", "/api/auth/session", "/messages/c1?_rsc=1"]) {
      expect(await dispatch(url), url).toBeNull();
    }
    expect(await dispatch("/_next/static/chunks/a.js", { method: "POST" })).toBeNull();
    expect(await dispatch("https://media.example.com/_next/static/chunks/a.js")).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("serves hashed static assets cache-first after the first fetch", async () => {
    const fetchImpl = vi.fn(async () => new Response("chunk"));
    const { dispatch } = load(fetchImpl);
    expect(await (await dispatch("/_next/static/chunks/a.js"))!.text()).toBe("chunk");
    expect(await (await dispatch("/_next/static/chunks/a.js"))!.text()).toBe("chunk");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed static response", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 }));
    const { dispatch } = load(fetchImpl);
    await dispatch("/_next/static/chunks/missing.js");
    await dispatch("/_next/static/chunks/missing.js");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("caps the static cache, dropping the oldest entries", async () => {
    const { dispatch, caches } = load(async () => new Response("x"));
    for (let i = 0; i < 405; i++) await dispatch(`/_next/static/chunks/${i}.js`);
    const store = [...caches.stores.entries()].find(([name]) => name.startsWith("yk3-static-"))![1];
    expect(store.size).toBe(400);
    expect(store.has(`${ORIGIN}/_next/static/chunks/0.js`)).toBe(false);
    expect(store.has(`${ORIGIN}/_next/static/chunks/404.js`)).toBe(true);
  });

  it("falls back to the cached offline page only when a navigation fails", async () => {
    let online = true;
    const { dispatch, caches } = load(async () => {
      if (!online) throw new TypeError("Failed to fetch");
      return new Response("page");
    });
    const shell = await caches.api.open("yk3-shell-v6");
    await shell.addAll(["/offline.html"]);
    expect(await (await dispatch("/home", { mode: "navigate" }))!.text()).toBe("page");
    online = false;
    expect(await (await dispatch("/home", { mode: "navigate" }))!.text()).toBe("/offline.html");
  });
});
