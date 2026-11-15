import { describe, expect, it } from "vitest";
import { internalNavigationHref, storyHistoryPopAction } from "./story-viewer-history";

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
    const action = storyHistoryPopAction({ onOwnEntry: current.has("viewer"), closing });
    if (action === "close") {
      open = false;
      break;
    }
    if (action === "ignore") break;
  }
  return { open, depth: stack.length, popped };
}

describe("storyHistoryPopAction", () => {
  it("closes once back leaves the viewer's own entry", () => {
    expect(storyHistoryPopAction({ onOwnEntry: false, closing: false })).toBe("close");
    expect(storyHistoryPopAction({ onOwnEntry: false, closing: true })).toBe("close");
  });

  it("stays open when back only closed a layer above it", () => {
    expect(storyHistoryPopAction({ onOwnEntry: true, closing: false })).toBe("ignore");
  });

  it("keeps going back while closing until past its own entry", () => {
    expect(storyHistoryPopAction({ onOwnEntry: true, closing: true })).toBe("back");
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
      const action = storyHistoryPopAction({ onOwnEntry: now.markers.has("viewer"), closing: true });
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
    expect(storyHistoryPopAction({ onOwnEntry: true, closing: false })).toBe("ignore");
  });
});
