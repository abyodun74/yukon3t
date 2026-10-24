import { describe, expect, it } from "vitest";
import {
  LONG_PRESS_DELAY_MS,
  LONG_PRESS_IDLE,
  LONG_PRESS_SLOP_PX,
  classifyPressTarget,
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
  const m = /^([a-z]*)((?:\[[^\]]+\])*)$/i.exec(selector);
  if (!m) throw new Error(`unsupported selector in fake DOM: ${selector}`);
  const [, tag, attrPart] = m;
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  for (const a of attrPart.match(/\[[^\]]+\]/g) ?? []) {
    const am = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(a);
    if (!am) throw new Error(`unsupported attribute selector: ${a}`);
    const value = node.getAttribute(am[1]);
    if (value === null) return false;
    if (am[2] !== undefined && value !== am[2]) return false;
  }
  return true;
}

describe("classifyPressTarget", () => {
  it("offers Copy link for a link, from the link or any child of it", () => {
    const p = el("p");
    const a = el("a", { href: "https://example.com/x" }, p);
    const span = el("span", {}, a);
    expect(classifyPressTarget(a, BASE)).toEqual({ kind: "menu", element: a, copyText: "https://example.com/x" });
    expect(classifyPressTarget(span, BASE)).toEqual({ kind: "menu", element: a, copyText: "https://example.com/x" });
  });

  it("an image or video inside a link copies the link (e.g. avatar -> profile)", () => {
    const a = el("a", { href: "/u/alice" });
    expect(classifyPressTarget(el("img", {}, a), BASE)).toMatchObject({
      kind: "menu",
      element: a,
      copyText: "https://yukon3t.com/u/alice",
    });
    expect(classifyPressTarget(el("video", {}, a), BASE)).toMatchObject({ kind: "menu", element: a });
  });

  it("a photo/video not in a link copies the page link, never the file's URL", () => {
    const card = el("div");
    const img = el("img", { src: "https://media.example.com/secret.jpg" }, card);
    expect(classifyPressTarget(img, BASE)).toEqual({ kind: "menu", element: img, copyText: BASE });
    const video = el("video", {}, card);
    expect(classifyPressTarget(video, BASE)).toEqual({ kind: "menu", element: video, copyText: BASE });
    const picture = el("picture", {}, card);
    expect(classifyPressTarget(el("source", {}, picture), BASE)).toMatchObject({ kind: "menu", element: picture });
  });

  it("media in a full-screen viewer (aria-modal) is suppressed: hold-to-pause / zoom keep working, no menu", () => {
    const modal = el("div", { "aria-modal": "true" });
    const img = el("img", {}, modal);
    expect(classifyPressTarget(img, BASE)).toEqual({ kind: "suppress", element: img });
    // ...but a real link inside a modal still gets the menu.
    const a = el("a", { href: "/u/bob" }, modal);
    expect(classifyPressTarget(a, BASE)).toMatchObject({ kind: "menu", element: a });
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
    expect(classifyPressTarget(el("img", {}, editable), BASE)).toEqual({ kind: "native" });
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
    const img = el("img", {}, optOut);
    expect(classifyPressTarget(img, BASE)).toEqual({ kind: "suppress", element: img });
  });

  it("app chrome (nav, tabs): native menu blocked, no menu of ours", () => {
    const nav = el("nav");
    const tab = el("a", { href: "/home" }, nav);
    expect(classifyPressTarget(tab, BASE)).toEqual({ kind: "suppress", element: tab });
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
