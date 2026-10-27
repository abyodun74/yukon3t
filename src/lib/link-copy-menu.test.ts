import { describe, expect, it } from "vitest";
import {
  CLIPBOARD_IMAGE_MAX_SIDE,
  LONG_PRESS_DELAY_MS,
  LONG_PRESS_IDLE,
  LONG_PRESS_SLOP_PX,
  classifyPressTarget,
  clipboardImageSize,
  externalCopyUrl,
  imageClipboardSupport,
  imageCopyTarget,
  isAndroidWebViewUserAgent,
  linkCopyText,
  longPressReducer,
  placeLinkMenu,
  type ElementLike,
  type LongPressState,
} from "./link-copy-menu";

const BASE = "https://yukon3t.com/messages/abc";

describe("linkCopyText", () => {
  it("keeps absolute web URLs", () => {
    expect(linkCopyText("https://example.com/a?b=1#c", BASE)).toBe("https://example.com/a?b=1#c");
    expect(linkCopyText("http://example.com", BASE)).toBe("http://example.com/");
  });

  it("resolves relative and root-relative hrefs against the page", () => {
    expect(linkCopyText("/u/alice", BASE)).toBe("https://yukon3t.com/u/alice");
    expect(linkCopyText("post/1", BASE)).toBe("https://yukon3t.com/messages/post/1");
    expect(linkCopyText("?tab=x", BASE)).toBe("https://yukon3t.com/messages/abc?tab=x");
    expect(linkCopyText("#section", BASE)).toBe("https://yukon3t.com/messages/abc#section");
  });

  it("copies the bare address / number for mailto, tel and sms", () => {
    expect(linkCopyText("mailto:hi@example.com?subject=Hello", BASE)).toBe("hi@example.com");
    expect(linkCopyText("MAILTO:a%40b.com", BASE)).toBe("a@b.com");
    expect(linkCopyText("tel:+1%20555%200100", BASE)).toBe("+1 555 0100");
    expect(linkCopyText("sms:+15550100?body=hi", BASE)).toBe("+15550100");
    expect(linkCopyText("mailto:", BASE)).toBeNull();
  });

  it("refuses links that aren't worth copying", () => {
    expect(linkCopyText(null, BASE)).toBeNull();
    expect(linkCopyText("", BASE)).toBeNull();
    expect(linkCopyText("  ", BASE)).toBeNull();
    expect(linkCopyText("#", BASE)).toBeNull();
    expect(linkCopyText("javascript:alert(1)", BASE)).toBeNull();
    expect(linkCopyText(" JavaScript:void(0)", BASE)).toBeNull();
    expect(linkCopyText("data:text/html,hi", BASE)).toBeNull();
  });

  it("does not throw on a malformed percent escape", () => {
    expect(linkCopyText("mailto:50%off@x.com", BASE)).toBe("50%off@x.com");
  });
});

/** A tiny fake DOM: each node knows its tag, attributes and parent; closest() supports the selectors the rules use. */
type FakeNode = ElementLike & { parent: FakeNode | null };

function el(tagName: string, attrs: Record<string, string> = {}, parent: FakeNode | null = null): FakeNode {
  const node: FakeNode = {
    tagName: tagName.toUpperCase(),
    parent,
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    closest(selector) {
      const alternatives = selector.split(",").map((s) => s.trim());
      for (let cur: FakeNode | null = node; cur; cur = cur.parent) {
        if (alternatives.some((alt) => matches(cur!, alt))) return cur;
      }
      return null;
    },
  };
  return node;
}

function matches(node: FakeNode, selector: string): boolean {
  const m = /^([a-z]*)((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/i.exec(selector);
  if (!m) throw new Error(`unsupported selector in fake DOM: ${selector}`);
  const [, tag, classPart, attrPart] = m;
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  const classes = (node.getAttribute("class") ?? "").split(/\s+/);
  for (const c of classPart.split(".").filter(Boolean)) if (!classes.includes(c)) return false;
  for (const a of attrPart.match(/\[[^\]]+\]/g) ?? []) {
    const am = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(a);
    if (!am) throw new Error(`unsupported attribute selector: ${a}`);
    const value = node.getAttribute(am[1]);
    if (value === null) return false;
    if (am[2] !== undefined && value !== am[2]) return false;
  }
  return true;
}

const R2 = "https://pub-x.r2.dev/posts/u1/photo.jpg";
const link = (text: string) => ({ type: "link", text });
const image = (src: string) => ({ type: "image", src });

describe("classifyPressTarget", () => {
  it("offers Copy link for a link, from the link or any child of it, copying its real destination", () => {
    const p = el("p");
    const a = el("a", { href: "https://example.com/x" }, p);
    const span = el("span", {}, a);
    expect(classifyPressTarget(a, BASE)).toEqual({ kind: "menu", element: a, copy: link("https://example.com/x") });
    expect(classifyPressTarget(span, BASE)).toEqual({ kind: "menu", element: a, copy: link("https://example.com/x") });
  });

  it("an in-app link copies its own address (that is the link that was pressed)", () => {
    const a = el("a", { href: "/u/alice" });
    expect(classifyPressTarget(a, BASE)).toEqual({ kind: "menu", element: a, copy: link("https://yukon3t.com/u/alice") });
  });

  it("a photo copies the picture itself, never the page URL or a yukon3t link", () => {
    const card = el("div");
    const button = el("button", {}, card);
    const img = el("img", { src: R2 }, button);
    expect(classifyPressTarget(img, BASE)).toEqual({ kind: "menu", element: img, copy: image(R2) });
  });

  it("a photo inside a link (album photo -> its post page) copies the photo, not the link", () => {
    const a = el("a", { href: "/post/p2" });
    const wrap = el("div", {}, a);
    const img = el("img", { src: R2 }, wrap);
    expect(classifyPressTarget(img, BASE)).toEqual({ kind: "menu", element: img, copy: image(R2) });
  });

  it("relative image sources resolve against the page", () => {
    const img = el("img", { src: "/icons/badge.png" });
    expect(classifyPressTarget(img, BASE)).toEqual({
      kind: "menu",
      element: img,
      copy: image("https://yukon3t.com/icons/badge.png"),
    });
  });

  it("a Giphy GIF copies its public Giphy link (a clipboard can't carry an animated GIF)", () => {
    const img = el("img", { src: "https://media2.giphy.com/media/abc/giphy.gif" });
    expect(classifyPressTarget(img, BASE)).toEqual({
      kind: "menu",
      element: img,
      copy: link("https://media2.giphy.com/media/abc/giphy.gif"),
    });
  });

  it("profile pictures are never copyable: no menu, or the surrounding profile link's menu", () => {
    const avatar = el("img", { src: "/api/avatar/u1/a-t.jpg", class: "protected-image h-full w-full" });
    expect(classifyPressTarget(avatar, BASE)).toEqual({ kind: "suppress", element: avatar });
    const profile = el("a", { href: "/u/alice" });
    const inLink = el("img", { src: R2, class: "img-fade-in protected-image" }, profile);
    expect(classifyPressTarget(inLink, BASE)).toEqual({
      kind: "menu",
      element: profile,
      copy: link("https://yukon3t.com/u/alice"),
    });
    // The protected-image class on a wrapper (the protected lightbox) covers everything in it too.
    const viewer = el("div", { class: "protected-image" });
    const big = el("img", { src: R2 }, viewer);
    expect(classifyPressTarget(big, BASE)).toEqual({ kind: "suppress", element: big });
  });

  it("an avatar address is refused even if a component forgot to protect it", () => {
    for (const src of ["/api/avatar/u1/x-t.jpg", "https://pub-x.r2.dev/avatar/u1/x.jpg"]) {
      const img = el("img", { src });
      expect(classifyPressTarget(img, BASE)).toEqual({ kind: "suppress", element: img });
    }
  });

  it("secret-chat media and story previews (data-no-copy-media) are not copyable", () => {
    const bubble = el("div", { "data-no-copy-media": "" });
    const img = el("img", { src: R2 }, el("button", {}, bubble));
    expect(classifyPressTarget(img, BASE)).toEqual({ kind: "suppress", element: img });
    // A link in the same bubble still copies its destination.
    const a = el("a", { href: "https://example.com" }, bubble);
    expect(classifyPressTarget(a, BASE)).toMatchObject({ kind: "menu", copy: link("https://example.com/") });
  });

  it("local blob:/data: pictures (previews, decrypted content) are not copyable", () => {
    for (const src of ["blob:https://yukon3t.com/1234", "data:image/png;base64,AAAA", ""]) {
      const img = el("img", { src });
      expect(classifyPressTarget(img, BASE)).toEqual({ kind: "suppress", element: img });
    }
    const noSrc = el("img");
    expect(classifyPressTarget(noSrc, BASE)).toEqual({ kind: "suppress", element: noSrc });
  });

  it("videos, audio and canvas get no Copy (no page/file URL is ever copied for them)", () => {
    const card = el("div");
    for (const tag of ["video", "audio", "canvas"]) {
      const media = el(tag, { src: "https://pub-x.r2.dev/v.mp4" }, card);
      expect(classifyPressTarget(media, BASE)).toEqual({ kind: "suppress", element: media });
    }
    // A video inside a link: the link's own menu.
    const a = el("a", { href: "/post/v1" });
    expect(classifyPressTarget(el("video", {}, a), BASE)).toMatchObject({ kind: "menu", element: a });
  });

  it("media in a full-screen viewer (aria-modal) is suppressed: hold-to-pause / zoom keep working, no menu", () => {
    const modal = el("div", { "aria-modal": "true" });
    const img = el("img", { src: R2 }, modal);
    expect(classifyPressTarget(img, BASE)).toEqual({ kind: "suppress", element: img });
    // ...but a real link inside a modal still gets the menu.
    const a = el("a", { href: "/u/bob" }, modal);
    expect(classifyPressTarget(a, BASE)).toMatchObject({ kind: "menu", element: a });
  });

  it("a data-copy-url card (LINK post, embed source line) copies its external URL, not the post", () => {
    const card = el("button", { "data-copy-url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
    const label = el("span", {}, card);
    expect(classifyPressTarget(label, BASE)).toEqual({
      kind: "menu",
      element: card,
      copy: link("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    });
    const bad = el("button", { "data-copy-url": "javascript:alert(1)" });
    expect(classifyPressTarget(bad, BASE)).toEqual({ kind: "suppress", element: bad });
    const relative = el("button", { "data-copy-url": "/post/1" });
    expect(classifyPressTarget(relative, BASE)).toEqual({ kind: "suppress", element: relative });
  });

  it("plain content (text, cards, empty space) keeps native selection", () => {
    const div = el("div");
    expect(classifyPressTarget(el("span", {}, div), BASE)).toEqual({ kind: "plain" });
    expect(classifyPressTarget(div, BASE)).toEqual({ kind: "plain" });
    expect(classifyPressTarget(null, BASE)).toEqual({ kind: "plain" });
    // <a> without href is not a link.
    expect(classifyPressTarget(el("a", {}, div), BASE)).toEqual({ kind: "plain" });
  });

  it("never touches text inputs, textareas or contenteditable (native Cut/Copy/Paste stays)", () => {
    const a = el("a", { href: "https://example.com" });
    expect(classifyPressTarget(el("input", {}, a), BASE)).toEqual({ kind: "native" });
    expect(classifyPressTarget(el("textarea"), BASE)).toEqual({ kind: "native" });
    expect(classifyPressTarget(el("select"), BASE)).toEqual({ kind: "native" });
    const editable = el("div", { contenteditable: "true" });
    expect(classifyPressTarget(el("a", { href: "https://x.com" }, editable), BASE)).toEqual({ kind: "native" });
    expect(classifyPressTarget(el("img", { src: R2 }, editable), BASE)).toEqual({ kind: "native" });
    const editableEmpty = el("div", { contenteditable: "" });
    expect(classifyPressTarget(el("span", {}, editableEmpty), BASE)).toEqual({ kind: "native" });
    // contenteditable="false" is not editable.
    const notEditable = el("div", { contenteditable: "false" });
    expect(classifyPressTarget(el("span", {}, notEditable), BASE)).toEqual({ kind: "plain" });
  });

  it("leaves embedded frames to themselves", () => {
    const a = el("a", { href: "https://example.com" });
    expect(classifyPressTarget(el("iframe", {}, a), BASE)).toEqual({ kind: "native" });
    expect(classifyPressTarget(el("embed"), BASE)).toEqual({ kind: "native" });
  });

  it("data-no-link-menu and role=button links: native menu still blocked, but no menu of ours", () => {
    const optOut = el("div", { "data-no-link-menu": "" });
    const a1 = el("a", { href: "/x" }, optOut);
    expect(classifyPressTarget(a1, BASE)).toEqual({ kind: "suppress", element: a1 });
    const a2 = el("a", { href: "/x", "data-no-link-menu": "" });
    expect(classifyPressTarget(a2, BASE)).toEqual({ kind: "suppress", element: a2 });
    const a3 = el("a", { href: "/x", role: "button" });
    expect(classifyPressTarget(a3, BASE)).toEqual({ kind: "suppress", element: a3 });
    const img = el("img", { src: R2 }, optOut);
    expect(classifyPressTarget(img, BASE)).toEqual({ kind: "suppress", element: img });
    const card = el("button", { "data-copy-url": "https://example.com" }, optOut);
    expect(classifyPressTarget(card, BASE)).toEqual({ kind: "suppress", element: card });
  });

  it("app chrome (nav, tabs): native menu blocked, no menu of ours, logo images included", () => {
    const nav = el("nav");
    const tab = el("a", { href: "/home" }, nav);
    expect(classifyPressTarget(tab, BASE)).toEqual({ kind: "suppress", element: tab });
    const logo = el("img", { src: "/icons/mark.png" }, tab);
    expect(classifyPressTarget(logo, BASE)).toEqual({ kind: "suppress", element: tab });
    const tabAnchor = el("a", { href: "/home", role: "tab" });
    expect(classifyPressTarget(tabAnchor, BASE)).toEqual({ kind: "suppress", element: tabAnchor });
  });

  it("links with nothing worth copying: native menu blocked, no menu", () => {
    const js = el("a", { href: "javascript:void(0)" });
    expect(classifyPressTarget(js, BASE)).toEqual({ kind: "suppress", element: js });
    const hash = el("a", { href: "#" });
    expect(classifyPressTarget(hash, BASE)).toEqual({ kind: "suppress", element: hash });
  });
});

describe("imageCopyTarget / externalCopyUrl", () => {
  it("accepts http(s) pictures and refuses everything else", () => {
    expect(imageCopyTarget(R2, BASE)).toEqual(image(R2));
    expect(imageCopyTarget("javascript:alert(1)", BASE)).toBeNull();
    expect(imageCopyTarget("blob:https://yukon3t.com/x", BASE)).toBeNull();
    expect(imageCopyTarget(null, BASE)).toBeNull();
    expect(imageCopyTarget("/API/AVATAR/u/x.jpg", BASE)).toBeNull();
    // A post photo whose path merely contains "avatar" further down is still a photo.
    expect(imageCopyTarget("https://pub-x.r2.dev/posts/avatar/x.jpg", BASE)).toEqual(
      image("https://pub-x.r2.dev/posts/avatar/x.jpg"),
    );
  });

  it("data-copy-url must be an absolute http(s) URL", () => {
    expect(externalCopyUrl("https://example.com/a b")).toBe("https://example.com/a%20b");
    expect(externalCopyUrl("mailto:x@y.z")).toBeNull();
    expect(externalCopyUrl("/relative")).toBeNull();
    expect(externalCopyUrl("")).toBeNull();
    expect(externalCopyUrl(undefined)).toBeNull();
  });
});

describe("imageClipboardSupport", () => {
  const ok = {
    nativePlugin: false,
    hasClipboardWrite: true,
    hasClipboardItem: true,
    supportsPng: undefined,
    androidWebView: false,
  };

  it("web in browsers with clipboard.write + ClipboardItem", () => {
    expect(imageClipboardSupport(ok)).toBe("web");
    expect(imageClipboardSupport({ ...ok, supportsPng: true })).toBe("web");
  });

  it("unsupported without the API, when PNG is refused, and in Android WebView without the plugin (drops images)", () => {
    expect(imageClipboardSupport({ ...ok, hasClipboardWrite: false })).toBe("unsupported");
    expect(imageClipboardSupport({ ...ok, hasClipboardItem: false })).toBe("unsupported");
    expect(imageClipboardSupport({ ...ok, supportsPng: false })).toBe("unsupported");
    expect(imageClipboardSupport({ ...ok, androidWebView: true, supportsPng: true })).toBe("unsupported");
  });

  it("native whenever the app build has the ImageClipboard plugin, even in Android WebView", () => {
    expect(imageClipboardSupport({ ...ok, nativePlugin: true, androidWebView: true })).toBe("native");
    expect(imageClipboardSupport({ ...ok, nativePlugin: true, androidWebView: true, supportsPng: false })).toBe(
      "native",
    );
    expect(
      imageClipboardSupport({ ...ok, nativePlugin: true, hasClipboardWrite: false, hasClipboardItem: false }),
    ).toBe("native");
  });

  it("older Android app build (no plugin) stays unsupported, so the menu offers Share photo", () => {
    expect(imageClipboardSupport({ ...ok, nativePlugin: false, androidWebView: true })).toBe("unsupported");
  });

  it("recognises Android WebView user agents only", () => {
    expect(
      isAndroidWebViewUserAgent(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36",
      ),
    ).toBe(true);
    expect(
      isAndroidWebViewUserAgent(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
      ),
    ).toBe(false);
    expect(
      isAndroidWebViewUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
      ),
    ).toBe(false);
  });
});

describe("clipboardImageSize", () => {
  it("keeps sizes within the cap and scales bigger ones down, keeping the ratio", () => {
    expect(clipboardImageSize(1080, 1350)).toEqual({ width: 1080, height: 1350 });
    expect(clipboardImageSize(8192, 4096)).toEqual({ width: CLIPBOARD_IMAGE_MAX_SIDE, height: 2048 });
    expect(clipboardImageSize(3000, 9000, 900)).toEqual({ width: 300, height: 900 });
    expect(clipboardImageSize(0, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe("longPressReducer", () => {
  const down = (id = 1, x = 100, y = 100, at = 0, touches = 1) =>
    ({ type: "down", id, x, y, at, touches }) as const;

  function run(events: Parameters<typeof longPressReducer>[1][]) {
    let state: LongPressState = LONG_PRESS_IDLE;
    let fires = 0;
    for (const e of events) {
      const r = longPressReducer(state, e);
      state = r.state;
      if (r.fire) fires += 1;
    }
    return { state, fires };
  }

  it("fires once when held still for the delay", () => {
    const r = run([down(), { type: "timeout", id: 1, at: LONG_PRESS_DELAY_MS }]);
    expect(r.fires).toBe(1);
    expect(r.state).toEqual({ phase: "fired", id: 1, x: 100, y: 100 });
    // A second timer tick for the same press does not fire again.
    expect(longPressReducer(r.state, { type: "timeout", id: 1, at: 9999 }).fire).toBe(false);
  });

  it("tolerates jitter within the slop", () => {
    const r = run([
      down(),
      { type: "move", x: 100 + LONG_PRESS_SLOP_PX, y: 100 - LONG_PRESS_SLOP_PX },
      { type: "timeout", id: 1, at: LONG_PRESS_DELAY_MS },
    ]);
    expect(r.fires).toBe(1);
  });

  it("cancels on movement past the slop (scroll / swipe-to-reply)", () => {
    expect(
      run([down(), { type: "move", x: 100, y: 100 + LONG_PRESS_SLOP_PX + 1 }, { type: "timeout", id: 1, at: 1000 }])
        .fires,
    ).toBe(0);
    expect(
      run([down(), { type: "move", x: 100 + LONG_PRESS_SLOP_PX + 1, y: 100 }, { type: "timeout", id: 1, at: 1000 }])
        .fires,
    ).toBe(0);
  });

  it("cancels on release, touchcancel or scroll before the delay", () => {
    for (const ev of [{ type: "up" }, { type: "cancel" }, { type: "scroll" }] as const) {
      const r = run([down(), ev, { type: "timeout", id: 1, at: LONG_PRESS_DELAY_MS }]);
      expect(r.fires).toBe(0);
      expect(r.state).toEqual(LONG_PRESS_IDLE);
    }
  });

  it("never fires for a multi-touch (pinch) start", () => {
    expect(run([down(1, 0, 0, 0, 2), { type: "timeout", id: 1, at: 1000 }]).fires).toBe(0);
  });

  it("ignores a stale timer from an earlier press and an early tick", () => {
    expect(run([down(1), { type: "up" }, down(2, 5, 5, 1000), { type: "timeout", id: 1, at: 2000 }]).fires).toBe(0);
    expect(run([down(1), { type: "timeout", id: 1, at: LONG_PRESS_DELAY_MS - 1 }]).fires).toBe(0);
  });

  it("honours custom delay/slop options", () => {
    const s1 = longPressReducer(LONG_PRESS_IDLE, down()).state;
    expect(longPressReducer(s1, { type: "move", x: 104, y: 100 }, { slopPx: 3 }).state).toEqual(LONG_PRESS_IDLE);
    expect(longPressReducer(s1, { type: "timeout", id: 1, at: 200 }, { delayMs: 200 }).fire).toBe(true);
  });

  it("returns to idle after release once fired", () => {
    const r = run([down(), { type: "timeout", id: 1, at: LONG_PRESS_DELAY_MS }, { type: "up" }]);
    expect(r.state).toEqual(LONG_PRESS_IDLE);
  });
});

describe("placeLinkMenu", () => {
  const viewport = { width: 400, height: 800 };
  const menu = { width: 160, height: 60 };

  it("centres above the finger when there is room", () => {
    expect(placeLinkMenu({ x: 200, y: 400 }, menu, viewport)).toEqual({ left: 120, top: 324 });
  });

  it("goes below the finger near the top", () => {
    expect(placeLinkMenu({ x: 200, y: 30 }, menu, viewport)).toEqual({ left: 120, top: 46 });
  });

  it("clamps to the viewport edges (both sides, bottom)", () => {
    expect(placeLinkMenu({ x: 5, y: 400 }, menu, viewport).left).toBe(12);
    expect(placeLinkMenu({ x: 395, y: 400 }, menu, viewport).left).toBe(400 - 160 - 12);
    expect(placeLinkMenu({ x: 200, y: 20 }, { width: 160, height: 790 }, viewport).top).toBe(12);
  });

  it("stays at the margin when the menu is wider than the viewport", () => {
    expect(placeLinkMenu({ x: 100, y: 400 }, { width: 500, height: 60 }, viewport).left).toBe(12);
  });
});
