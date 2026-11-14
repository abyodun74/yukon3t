// The app's one z-index scale for everything that floats over the page. Every overlay (sheet, picker, menu, viewer,
// call UI, toast, banner) takes its stacking level from here or from the matching CSS variable in globals.css
// (`--z-<name>`, used as `z-[var(--z-sheet)]`), never from a hand-picked `z-50` / `z-[70]` / `z-[100]`.
// src/lib/overlay-layers.test.ts keeps the two in sync and scans overlay components for stray numbers.
//
// Order, lowest to highest (owner decision 2026-11-14, after a started call hid behind the Connections list and the
// Story composer opened invisibly from the create picker):
//
//   page content < bottom tab bar < scroll FAB < sticky header < pickers/sheets/menus
//     < live video < live gift effects < full-screen composers/viewers (Story, Muse, lightbox, live room chrome)
//     < live call controls < confirm dialogs < blocking screens < ACTIVE CALL UI < call controls
//     < incoming-call ring < toasts/system banners < system (splash) < context menu
//
// Why the active call sits above every picker, sheet and viewer: a call that was just started or answered must always
// be visible, whatever was on screen when it started (the call start also closes every registered sheet, see
// src/lib/overlay-registry.ts). The live-stream video is the one call surface that stays low: it is the background of
// the live room, whose own controls (viewer tier) must stay above it.
//
// Overlays render into the single root host (`#overlay-root`, src/app/layout.tsx) through createPortal, so a value
// here is compared with every other overlay's value in one stacking context (body), never trapped inside a
// transformed, filtered or scrolling ancestor.

export const OVERLAY_LAYERS = {
  /** Ordinary page content. */
  content: 0,
  /** nav.tsx's fixed bottom tab bar. */
  navBar: 30,
  /** Floating action buttons over the page (scroll-to-top FAB). */
  floating: 35,
  /** nav.tsx's sticky top header. */
  header: 40,
  /** Pickers, bottom sheets, dialogs and popup menus opened from the page (Sheet's default). */
  sheet: 50,
  /** The live stream's video (GlobalCallFrame with the live renderer): the background of the live room. */
  liveVideo: 60,
  /** Gift / challenge effects over the live video (live-gift-layer.tsx). */
  liveEffects: 65,
  /** Full-screen composers and viewers: Story viewer, Muse viewer, lightbox, view-once viewer, live room controls. */
  viewer: 70,
  /** GlobalCallFrame's Leave/Minimize bar during a live stream: above the live room's own controls. */
  liveControls: 80,
  /** Confirmation dialogs (ConfirmDialog), above every sheet and viewer that can ask for one. */
  confirm: 90,
  /** Screens that block the app (forced update) and the share-in sheet from another app. */
  blocking: 95,
  /** An active 1:1 / group / Collab call, fullscreen or minimized: above every picker, sheet and viewer. */
  call: 100,
  /** The active call's Leave / Minimize / Add person bar. */
  callControls: 105,
  /** The incoming-call ring card. */
  incomingCall: 110,
  /** Toasts and system banners (offline). */
  toast: 120,
  /** The launch splash. */
  system: 130,
  /** The long-press Copy photo / Copy link menu: always on top of whatever was pressed. */
  contextMenu: 140,
} as const;

export type OverlayLayer = keyof typeof OVERLAY_LAYERS;

/** The id of the one element every overlay portals into (rendered last in <body> by the root layout). */
export const OVERLAY_ROOT_ID = "overlay-root";

/**
 * The z-index of an overlay opened from inside another one: never below its own tier, and always one above the
 * overlay it was opened from (a share sheet from inside the Story viewer, the add-person picker inside a call, a
 * sheet from a sheet), so a child can never open underneath its parent. `parent` is null at the page level.
 */
export function nestedLayer(requested: number, parent: number | null): number {
  if (parent === null || !Number.isFinite(parent)) return requested;
  return Math.max(requested, parent + 1);
}

/** The CSS custom property name for a layer (`--z-sheet`), defined on :root in globals.css. */
export function layerVar(layer: OverlayLayer): string {
  return `--z-${layer.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** The z-index of the active call UI for a session renderer: the live stream video stays under the live room. */
export function callFrameLayer(renderer: string | undefined): { frame: number; controls: number } {
  if (renderer === "custom") return { frame: OVERLAY_LAYERS.liveVideo, controls: OVERLAY_LAYERS.liveControls };
  return { frame: OVERLAY_LAYERS.call, controls: OVERLAY_LAYERS.callControls };
}
