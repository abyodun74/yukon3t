import { afterEach, describe, expect, it, vi } from "vitest";
import { backOutOfLayerThen, internalNavigationHref, viewerHistoryPopAction } from "./viewer-history";

// A small model of the history stack the viewer and the layers inside it build: each entry is the set of markers its
// state carries (a layer's entry copies the one under it and adds its own marker, as useBackDismiss does).
type Entry = Set<string>;

function simulate(stack: Entry[], { closing }: { closing: boolean }) {
  const popped: string[] = [];
  let open = true;
  // Walk back one entry at a time, as the browser does on history.back(), running the viewer's popstate rule.
  for (;;) {
    stack.pop();
    const current = stack[stack.length - 1] ?? new Set<string>();
    popped.push([...current].join("+") || "page");
    const action = viewerHistoryPopAction({ onOwnEntry: current.has("viewer"), closing });
    if (action === "close") {
      open = false;
      break;
    }
    if (action === "ignore") break;
  }
  return { open, depth: stack.length, popped };
}

describe("viewerHistoryPopAction", () => {
  it("closes once back leaves the viewer's own entry", () => {
    expect(viewerHistoryPopAction({ onOwnEntry: false, closing: false })).toBe("close");
    expect(viewerHistoryPopAction({ onOwnEntry: false, closing: true })).toBe("close");
  });

  it("stays open when back only closed a layer above it", () => {
    expect(viewerHistoryPopAction({ onOwnEntry: true, closing: false })).toBe("ignore");
  });

  it("keeps going back while closing until past its own entry", () => {
    expect(viewerHistoryPopAction({ onOwnEntry: true, closing: true })).toBe("back");
  });
});

describe("history stays consistent", () => {
  const page = () => new Set<string>();
  const viewer = () => new Set(["viewer"]);
  const comments = () => new Set(["viewer", "comments"]);

  it("back with the comments panel open closes only the panel", () => {
    const r = simulate([page(), viewer(), comments()], { closing: false });
    expect(r.open).toBe(true);
    expect(r.depth).toBe(2);
  });

  it("back with nothing open closes the viewer and lands on the page entry", () => {
    const r = simulate([page(), viewer()], { closing: false });
    expect(r.open).toBe(false);
    expect(r.depth).toBe(1);
  });

  it("the X (or a drag down / Escape) with a panel open removes both entries, never more", () => {
    const r = simulate([page(), viewer(), comments()], { closing: true });
    expect(r.open).toBe(false);
    expect(r.depth).toBe(1);
  });

  it("the X with a panel and a sheet open on top still lands exactly on the page", () => {
    const share = new Set(["viewer", "comments", "share"]);
    const r = simulate([page(), viewer(), comments(), share], { closing: true });
    expect(r.open).toBe(false);
    expect(r.depth).toBe(1);
  });
});

describe("internalNavigationHref", () => {
  const base = {
    origin: "https://yukon3t.com",
    currentPath: "/home",
    target: "",
    download: false,
    button: 0,
    modifier: false,
  };

  it("returns the in-app path for a plain click on an internal link", () => {
    expect(internalNavigationHref({ ...base, href: "https://yukon3t.com/u/abc" })).toBe("/u/abc");
    expect(internalNavigationHref({ ...base, href: "/post/p1?x=1#c" })).toBe("/post/p1?x=1#c");
  });

  it("leaves other origins, new-tab clicks, downloads and the same page alone", () => {
    expect(internalNavigationHref({ ...base, href: "https://example.com/a" })).toBeNull();
    expect(internalNavigationHref({ ...base, href: "/u/abc", modifier: true })).toBeNull();
    expect(internalNavigationHref({ ...base, href: "/u/abc", button: 1 })).toBeNull();
    expect(internalNavigationHref({ ...base, href: "/u/abc", target: "_blank" })).toBeNull();
    expect(internalNavigationHref({ ...base, href: "/u/abc", download: true })).toBeNull();
    expect(internalNavigationHref({ ...base, href: "/home#top" })).toBeNull();
    expect(internalNavigationHref({ ...base, href: "/u/abc", target: "_self" })).toBe("/u/abc");
  });
});

describe("open viewer -> tap author -> back", () => {
  type Url = { url: string; markers: Set<string> };

  // A browser-like history: a list of entries and a cursor. pushState truncates anything after the cursor, as
  // Next.js's router.push does.
  function makeHistory(start: string) {
    const entries: Url[] = [{ url: start, markers: new Set() }];
    let index = 0;
    return {
      get current() {
        return entries[index];
      },
      get length() {
        return entries.length;
      },
      push(entry: Url) {
        entries.splice(index + 1);
        entries.push(entry);
        index = entries.length - 1;
      },
      back() {
        index = Math.max(0, index - 1);
        return entries[index];
      },
      urls: () => entries.map((e) => e.url),
    };
  }

  /** The viewer's close walk (story-viewer-history.ts): back until off its own entry, then run `after`. */
  function closeViewerThen(h: ReturnType<typeof makeHistory>, after: () => void) {
    for (;;) {
      const now = h.back();
      const action = viewerHistoryPopAction({ onOwnEntry: now.markers.has("viewer"), closing: true });
      if (action === "close") break;
    }
    after();
  }

  it("back from the author's profile returns to Home, with no orphan Home entry", () => {
    const h = makeHistory("/home");
    h.push({ url: "/home", markers: new Set(["viewer"]) }); // viewer opens
    closeViewerThen(h, () => h.push({ url: "/u/author", markers: new Set() })); // tap author
    expect(h.urls()).toEqual(["/home", "/u/author"]);
    expect(h.back().url).toBe("/home");
    expect(h.current.markers.size).toBe(0);
  });

  it("also with comments and the emoji picker open on top", () => {
    const h = makeHistory("/home");
    h.push({ url: "/home", markers: new Set(["viewer"]) });
    h.push({ url: "/home", markers: new Set(["viewer", "comments"]) });
    h.push({ url: "/home", markers: new Set(["viewer", "comments", "emoji"]) });
    closeViewerThen(h, () => h.push({ url: "/post/p1", markers: new Set() }));
    expect(h.urls()).toEqual(["/home", "/post/p1"]);
    expect(h.back().url).toBe("/home");
  });

  it("the old behaviour (navigate straight from the viewer's entry) left an orphan", () => {
    const h = makeHistory("/home");
    h.push({ url: "/home", markers: new Set(["viewer"]) });
    h.push({ url: "/u/author", markers: new Set() });
    expect(h.back().markers.has("viewer")).toBe(true);
  });
});

describe("emoji picker back entry", () => {
  it("back with the emoji picker open closes only the picker; the viewer stays", () => {
    // The picker's entry copies the viewer's marker, so after its pop the viewer is still on its own entry.
    expect(viewerHistoryPopAction({ onOwnEntry: true, closing: false })).toBe("ignore");
  });
});

describe("open Muse viewer -> tap author/link -> back", () => {
  // The same browser-like history as above, for the Muse viewer over Home (MuseViewerOverlay, useViewerHistory) with
  // MuseFeed's comments entry and the comments sheet's emoji/GIF panel entry (useBackDismiss) on top. Each layer's
  // entry copies the markers under it, as the real code does.
  type Url = { url: string; markers: Set<string> };
  function makeHistory(start: string) {
    const entries: Url[] = [{ url: start, markers: new Set() }];
    let index = 0;
    return {
      get current() {
        return entries[index];
      },
      push(entry: Url) {
        entries.splice(index + 1);
        entries.push(entry);
        index = entries.length - 1;
      },
      back() {
        index = Math.max(0, index - 1);
        return entries[index];
      },
      urls: () => entries.slice(0, index + 1).map((e) => e.url),
    };
  }
  function closeViewerThen(h: ReturnType<typeof makeHistory>, after: () => void) {
    for (;;) {
      const now = h.back();
      if (viewerHistoryPopAction({ onOwnEntry: now.markers.has("viewer"), closing: true }) === "close") break;
    }
    after();
  }
  const open = (h: ReturnType<typeof makeHistory>, ...markers: string[]) =>
    h.push({ url: h.current.url, markers: new Set([...h.current.markers, ...markers]) });

  it("tapping the author's name returns to Home on Back, with no orphan Home entry", () => {
    const h = makeHistory("/home");
    open(h, "viewer");
    closeViewerThen(h, () => h.push({ url: "/u/author", markers: new Set() }));
    expect(h.urls()).toEqual(["/home", "/u/author"]);
    expect(h.back()).toEqual({ url: "/home", markers: new Set() });
  });

  it("a link in the comments, with the emoji/GIF panel open, still lands on the page entry", () => {
    const h = makeHistory("/home");
    open(h, "viewer");
    open(h, "museComments");
    open(h, "panel");
    closeViewerThen(h, () => h.push({ url: "/u/commenter", markers: new Set() }));
    expect(h.urls()).toEqual(["/home", "/u/commenter"]);
    expect(h.back().markers.size).toBe(0);
  });

  it("Back closes the panel, then the comments sheet, then the viewer, one layer per press", () => {
    const h = makeHistory("/home");
    open(h, "viewer");
    open(h, "museComments");
    open(h, "panel");
    const layersAfterBack = () => {
      const now = h.back();
      const action = viewerHistoryPopAction({ onOwnEntry: now.markers.has("viewer"), closing: false });
      return { action, comments: now.markers.has("museComments"), panel: now.markers.has("panel") };
    };
    expect(layersAfterBack()).toEqual({ action: "ignore", comments: true, panel: false }); // panel closes
    expect(layersAfterBack()).toEqual({ action: "ignore", comments: false, panel: false }); // sheet closes
    expect(layersAfterBack()).toEqual({ action: "close", comments: false, panel: false }); // viewer closes
    expect(h.urls()).toEqual(["/home"]);
  });
});

describe("backOutOfLayerThen (/muse with the comments open -> tap a name -> back)", () => {
  type State = Record<string, unknown> | null;
  // A fake window whose history.back() fires popstate a tick later, like a browser.
  function installWindow(stack: State[]) {
    const listeners = new Set<() => void>();
    let index = stack.length - 1;
    const win = {
      history: {
        get state() {
          return stack[index];
        },
        back: vi.fn(() => {
          setTimeout(() => {
            index = Math.max(0, index - 1);
            for (const l of [...listeners]) l();
          }, 0);
        }),
      },
      addEventListener: (type: string, l: () => void) => type === "popstate" && listeners.add(l),
      removeEventListener: (type: string, l: () => void) => type === "popstate" && listeners.delete(l),
      get index() {
        return index;
      },
    };
    vi.stubGlobal("window", win);
    return win;
  }
  const onComments = () => Boolean((window.history.state as { museComments?: boolean } | null)?.museComments);

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("goes back past the comments and panel entries, then navigates once", async () => {
    vi.useFakeTimers();
    const win = installWindow([{ page: 1 }, { page: 1, museComments: true }, { page: 1, museComments: true, panel: true }]);
    const after = vi.fn();
    backOutOfLayerThen(onComments, after);
    await vi.runAllTimersAsync();
    expect(win.index).toBe(0);
    expect(win.history.back).toHaveBeenCalledTimes(2);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("navigates at once when no layer entry is on top", async () => {
    vi.useFakeTimers();
    const win = installWindow([{ page: 1 }]);
    const after = vi.fn();
    backOutOfLayerThen(onComments, after);
    expect(after).toHaveBeenCalledTimes(1);
    expect(win.history.back).not.toHaveBeenCalled();
  });
});
