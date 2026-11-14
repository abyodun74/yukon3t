import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { OVERLAY_LAYERS, OVERLAY_ROOT_ID, callFrameLayer, layerVar, nestedLayer, type OverlayLayer } from "./overlay-layers";

const SRC = join(import.meta.dirname, "..");
const read = (file: string) => readFileSync(join(SRC, file), "utf8");
const css = read("app/globals.css");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return filesUnder(full);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

describe("overlay layer scale", () => {
  it("orders every overlay as the owner specified, lowest to highest", () => {
    const order: OverlayLayer[] = [
      "content",
      "navBar",
      "floating",
      "header",
      "sheet",
      "liveVideo",
      "liveEffects",
      "viewer",
      "liveControls",
      "confirm",
      "blocking",
      "call",
      "callControls",
      "incomingCall",
      "toast",
      "system",
      "contextMenu",
    ];
    expect(order.sort((a, b) => OVERLAY_LAYERS[a] - OVERLAY_LAYERS[b])).toEqual(order);
    expect(new Set(Object.values(OVERLAY_LAYERS)).size).toBe(Object.keys(OVERLAY_LAYERS).length);
    expect(Object.keys(OVERLAY_LAYERS).sort()).toEqual([...order].sort());
  });

  it("puts the active call above every picker, sheet, viewer and confirm dialog, and below the ring and toasts", () => {
    for (const renderer of ["direct", "prebuilt", undefined]) {
      const { frame, controls } = callFrameLayer(renderer);
      for (const below of ["navBar", "header", "sheet", "viewer", "liveControls", "confirm", "blocking"] as const) {
        expect(frame, `${renderer} vs ${below}`).toBeGreaterThan(OVERLAY_LAYERS[below]);
      }
      expect(controls).toBeGreaterThan(frame);
      expect(OVERLAY_LAYERS.incomingCall).toBeGreaterThan(controls);
      expect(OVERLAY_LAYERS.toast).toBeGreaterThan(OVERLAY_LAYERS.incomingCall);
    }
    // A sheet opened from inside the call (Add person) still lands above the call and below the ring.
    const addPerson = nestedLayer(OVERLAY_LAYERS.sheet, callFrameLayer("direct").controls);
    expect(addPerson).toBeGreaterThan(callFrameLayer("direct").controls);
    expect(addPerson).toBeLessThan(OVERLAY_LAYERS.incomingCall);
  });

  it("keeps the live stream video under the live room's controls, and its Leave bar above them", () => {
    const live = callFrameLayer("custom");
    expect(live.frame).toBeLessThan(OVERLAY_LAYERS.liveEffects);
    expect(OVERLAY_LAYERS.liveEffects).toBeLessThan(OVERLAY_LAYERS.viewer);
    expect(live.controls).toBeGreaterThan(OVERLAY_LAYERS.viewer);
  });

  it("keeps confirm dialogs above every viewer and the sheets opened from one (Muse comments)", () => {
    expect(OVERLAY_LAYERS.confirm).toBeGreaterThan(nestedLayer(OVERLAY_LAYERS.sheet, OVERLAY_LAYERS.viewer));
    expect(nestedLayer(OVERLAY_LAYERS.confirm, OVERLAY_LAYERS.viewer)).toBe(OVERLAY_LAYERS.confirm);
  });

  it("opens a child overlay one above its parent, never below its own tier", () => {
    expect(nestedLayer(50, null)).toBe(50);
    expect(nestedLayer(50, 70)).toBe(71);
    expect(nestedLayer(90, 70)).toBe(90);
    expect(nestedLayer(50, 50)).toBe(51);
    expect(nestedLayer(50, Number.NaN)).toBe(50);
  });

  it("defines the same numbers as CSS variables on :root", () => {
    for (const [name, value] of Object.entries(OVERLAY_LAYERS)) {
      const match = new RegExp(`${layerVar(name as OverlayLayer)}:\\s*(\\d+);`).exec(css);
      expect(match?.[1], name).toBe(String(value));
    }
    expect(layerVar("callControls")).toBe("--z-call-controls");
    expect(css).toMatch(/\.app-splash \{[^}]*z-index: var\(--z-system\);/);
  });
});

/**
 * Overlay components take their z-index from the scale (a `--z-*` variable, OVERLAY_LAYERS, or useOverlayZ /
 * callFrameLayer), never a hand-picked number above the nav bar's. Values up to 30 are local stacking inside an
 * overlay's own box (a close button over a photo, the Story viewer's delete row) and are fine. Each exception says why.
 */
const ALLOWED_RAW_Z: Record<string, string> = {
  "components/muse-feed.tsx":
    "Its z-10..z-[80] are inside the Muse viewer's own stacking context or relative to the /muse page's feed; owned by the Muse card work in progress, left as is.",
  "components/muse-comments-sheet.tsx":
    "Its z-50 positions the comments panel inside the Muse card's own stacking context (it is not an app-level overlay); ConfirmDialog stays above it on the confirm layer.",
  "components/chat-thread.tsx":
    "relative z-[60] on an inline composer row (not an overlay) keeps it above the emoji popup it opens, at page level.",
  "app/page.tsx": "Landing page decoration (z-10), not an overlay.",
};

describe("overlay components use the layer scale", () => {
  const files = filesUnder(SRC).map((f) => ({ file: relative(SRC, f).split(sep).join("/"), source: readFileSync(f, "utf8") }));

  it("has no ad-hoc z-index above the nav bar's outside the allow-list", () => {
    const offenders: string[] = [];
    for (const { file, source } of files) {
      if (file.startsWith("generated/") || ALLOWED_RAW_Z[file]) continue;
      const code = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of code.matchAll(/(?<![\w-])z-(\d+)(?![\w\]])|(?<![\w-])z-\[(\d+)\]|zIndex:\s*(\d+)/g)) {
        const value = Number(m[1] ?? m[2] ?? m[3]);
        if (value > OVERLAY_LAYERS.navBar) offenders.push(`${file}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps every allow-list entry real (the file exists and still needs it)", () => {
    for (const file of Object.keys(ALLOWED_RAW_Z)) {
      const entry = files.find((f) => f.file === file);
      expect(entry, file).toBeDefined();
      expect(entry!.source, file).toMatch(/(?<![\w-])z-(\d+|\[\d+\])/);
    }
  });

  it("uses only defined --z-* variables", () => {
    const defined = new Set(Object.keys(OVERLAY_LAYERS).map((k) => layerVar(k as OverlayLayer)));
    for (const { file, source } of files) {
      for (const m of source.matchAll(/var\((--z-[a-z-]+)\)/g)) expect(defined.has(m[1]), `${file}: ${m[1]}`).toBe(true);
    }
  });
});

describe("overlays render through the root overlay host", () => {
  it("has the host in the root layout, last in <body>, with viewport-fit=cover for the safe areas", () => {
    const layout = read("app/layout.tsx");
    expect(OVERLAY_ROOT_ID).toBe("overlay-root");
    expect(layout).toMatch(/<div id=\{OVERLAY_ROOT_ID\} \/>\s*<\/body>/);
    expect(layout).toMatch(/viewportFit: "cover"/);
  });

  it("portals every Sheet (and so ConfirmDialog, the create picker and the Story composer)", () => {
    const sheet = read("components/sheet.tsx");
    expect(sheet).toMatch(/<OverlayPortal z=\{z\}>/);
    expect(sheet).toMatch(/const z = useOverlayZ\(layer\)/);
    expect(sheet).toMatch(/style=\{\{ zIndex,/);
    expect(sheet).not.toMatch(/\bz-50\b/);
    const confirm = read("components/confirm-dialog.tsx");
    expect(confirm).toMatch(/layer="confirm"/);
    expect(confirm).toMatch(/stopEventPropagation/);
    expect(confirm).not.toMatch(/createPortal\(/);
  });

  it("renders the Story composer as a bounded, scrollable Sheet with no stacking-context wrapper", () => {
    const story = read("components/story-upload-modal.tsx");
    expect(story).toMatch(/<Sheet open=\{open\} onClose=\{onClose\} title=\{t\.stories\.addToStory\} panelClassName="overlay-panel-bounded">/);
    expect(story).not.toMatch(/className="relative z-/);
    const rule = /\.overlay-panel-bounded \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/100dvh/);
    expect(rule).toMatch(/safe-area-inset-top/);
    expect(rule).toMatch(/safe-area-inset-bottom/);
    expect(rule).toMatch(/overflow-y: auto/);
  });

  it("portals the call UI and the incoming ring onto their layers", () => {
    const frame = read("components/global-call-frame.tsx");
    expect(frame).toMatch(/const layer = callFrameLayer\(session\.renderer\)/);
    expect(frame).toMatch(/<OverlayPortal z=\{layer\.controls\}>/);
    expect(frame).toMatch(/zIndex: layer\.frame/);
    expect(frame).toMatch(/zIndex: layer\.controls/);
    const ring = read("components/incoming-call-listener.tsx");
    expect(ring).toMatch(/useOverlayZ\("incomingCall"\)/);
    expect(ring).toMatch(/<OverlayPortal z=\{ringZ\}>/);
  });

  it("portals the full-screen viewers onto the viewer layer", () => {
    for (const file of ["story-viewer", "lightbox", "view-once-viewer", "muse-viewer-overlay"]) {
      const source = read(`components/${file}.tsx`);
      expect(source, file).toMatch(/useOverlayZ\("viewer"\)/);
      expect(source, file).toMatch(/<OverlayPortal z=\{viewerZ\}>/);
    }
  });

  it("carries an English part's lang/dir into the sheets it opens", () => {
    expect(read("components/english-only.tsx")).toMatch(/<OverlayLangProvider lang="en" dir="ltr">/);
    expect(read("components/sheet.tsx")).toMatch(/const sheetLang = lang \?\? inherited\?\.lang/);
  });
});

describe("entrance animations leave no transform behind", () => {
  // A lingering transform makes an element the containing block of every position: fixed descendant: the
  // Connections row whose "Calling…" sheet was trapped inside it.
  for (const cls of [".animate-rise-in", ".inbox-row", ".animate-message-in", ".animate-modal-panel-in", ".story-media-in"]) {
    it(`${cls} uses fill-mode backwards`, () => {
      const rule = new RegExp(`\\${cls} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
      expect(rule).toMatch(/animation: [^;]* backwards;/);
      expect(rule).not.toMatch(/\bboth;/);
    });
  }
});
