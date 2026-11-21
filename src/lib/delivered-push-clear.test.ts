import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Opening a chat / story removes its pushes from the iPhone's Notification Center or the browser's notification list
// (web push), and only those: never another chat's, never a hidden chat's generic push. Android needs nothing here
// (MainActivity.onResume clears the app's drawer). The device APIs are mocked; whether an iPhone really hands back and
// removes these notifications can only be checked on a phone.

const native = { isNative: false, plugin: true, platform: "ios" };
const getDeliveredNotifications = vi.fn();
const removeDeliveredNotifications = vi.fn();

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => native.isNative,
    getPlatform: () => native.platform,
    isPluginAvailable: () => native.plugin,
  },
}));
vi.mock("@capacitor-firebase/messaging", () => ({
  FirebaseMessaging: {
    getDeliveredNotifications: () => getDeliveredNotifications(),
    removeDeliveredNotifications: (a: unknown) => removeDeliveredNotifications(a),
  },
}));

const { clearDeliveredPushesFor, deliveredPushMatches } = await import("@/lib/delivered-push-clear");

const ORIGIN = "https://yukon3t.com";
const CHAT = "/messages/cconv000000001";
const STORY = "/u/cowner00000001?story=cstory00000001";

describe("deliveredPushMatches", () => {
  it("matches by url (iOS data, web push absolute url)", () => {
    expect(deliveredPushMatches({ data: { url: CHAT } }, CHAT, ORIGIN)).toBe(true);
    expect(deliveredPushMatches({ data: { url: `${ORIGIN}${CHAT}` } }, CHAT, ORIGIN)).toBe(true);
    expect(deliveredPushMatches({ data: { url: STORY } }, STORY, ORIGIN)).toBe(true);
  });

  it("never matches another chat or story, a hidden chat's generic push, or another site", () => {
    expect(deliveredPushMatches({ data: { url: "/messages/cconv000000002" } }, CHAT, ORIGIN)).toBe(false);
    expect(deliveredPushMatches({ data: { url: "/home" } }, CHAT, ORIGIN)).toBe(false);
    expect(deliveredPushMatches({ data: { url: `https://evil.example${CHAT}` } }, CHAT, ORIGIN)).toBe(false);
    expect(deliveredPushMatches({ data: { url: "/u/cowner00000001?story=cother" } }, STORY, ORIGIN)).toBe(false);
    expect(deliveredPushMatches({ data: { url: `${CHAT}/x` } }, CHAT, ORIGIN)).toBe(false);
    expect(deliveredPushMatches({}, CHAT, ORIGIN)).toBe(false);
  });
});

describe("clearDeliveredPushesFor", () => {
  const close = { mine: vi.fn(), other: vi.fn() };
  let getRegistration: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    native.isNative = false;
    native.plugin = true;
    native.platform = "ios";
    getRegistration = vi.fn(async () => ({
      getNotifications: async () => [
        { data: { url: `${ORIGIN}${CHAT}` }, close: close.mine },
        { data: { url: `${ORIGIN}/messages/cconv000000002` }, close: close.other },
      ],
    }));
    vi.stubGlobal("window", { location: { origin: ORIGIN } });
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("web: closes only this chat's notifications", async () => {
    await clearDeliveredPushesFor(CHAT);
    expect(close.mine).toHaveBeenCalledTimes(1);
    expect(close.other).not.toHaveBeenCalled();
  });

  it("iPhone: removes only the matching delivered pushes", async () => {
    native.isNative = true;
    const mine = { id: "ios-1", data: { url: CHAT, type: "MESSAGE" } };
    const mineToo = { id: "ios-2", data: { url: CHAT } };
    getDeliveredNotifications.mockResolvedValue({
      notifications: [mine, { id: "ios-3", data: { url: "/messages/cconv000000002" } }, mineToo, { id: "x", data: { url: "/home" } }],
    });
    await clearDeliveredPushesFor(CHAT);
    expect(removeDeliveredNotifications).toHaveBeenCalledWith({ notifications: [mine, mineToo] });
    expect(getRegistration).not.toHaveBeenCalled();
  });

  it("Android app: touches nothing (the app clears its drawer on resume)", async () => {
    native.isNative = true;
    native.platform = "android";
    await clearDeliveredPushesFor(CHAT);
    expect(getDeliveredNotifications).not.toHaveBeenCalled();
    expect(getRegistration).not.toHaveBeenCalled();
  });

  it("native: calls nothing to remove when nothing matches, or the plugin isn't there", async () => {
    native.isNative = true;
    getDeliveredNotifications.mockResolvedValue({ notifications: [{ id: "0", data: { url: "/messages/other" } }] });
    await clearDeliveredPushesFor(CHAT);
    expect(removeDeliveredNotifications).not.toHaveBeenCalled();
    native.plugin = false;
    await clearDeliveredPushesFor(CHAT);
    expect(getDeliveredNotifications).toHaveBeenCalledTimes(1);
  });

  it("never throws: a failing plugin or browser API is swallowed", async () => {
    native.isNative = true;
    getDeliveredNotifications.mockRejectedValue(new Error("not implemented"));
    await expect(clearDeliveredPushesFor(CHAT)).resolves.toBeUndefined();
    native.isNative = false;
    getRegistration.mockRejectedValue(new Error("no sw"));
    await expect(clearDeliveredPushesFor(CHAT)).resolves.toBeUndefined();
    vi.stubGlobal("navigator", {});
    await expect(clearDeliveredPushesFor(CHAT)).resolves.toBeUndefined();
  });
});
