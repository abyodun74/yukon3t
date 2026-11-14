// Every open picker, sheet, list dialog and confirm dialog registers its close function here while it is open, so one
// call can close them all: `closeAllOverlays()`, run when a call session starts (CallSessionProvider.startSession for a
// new 1:1 / group call, outgoing or answered, and CallButton the moment it starts ringing). That is what makes a
// started call never sit behind (or under) the sheet or list it was started from: the sheet is gone, and the call UI
// is on the call layer above everything else anyway (src/lib/overlay-layers.ts).
//
// Module-level on purpose (not React state): it has to be reachable from code that isn't under the overlay's React
// tree (the call session provider at the root), and nothing renders from it. Pure apart from that one Map; tested in
// overlay-registry.test.ts.

export type OverlayKind = "sheet" | "confirm" | "menu" | "other";

type Entry = { close: () => void; kind: OverlayKind };

const entries = new Map<number, Entry>();
let nextId = 1;

/**
 * Registers an open overlay; returns the function that unregisters it (call it when the overlay closes or unmounts,
 * typically an effect cleanup). Unregistering twice is harmless.
 */
export function registerOverlay(close: () => void, kind: OverlayKind = "sheet"): () => void {
  const id = nextId++;
  entries.set(id, { close, kind });
  return () => {
    entries.delete(id);
  };
}

/**
 * Closes every registered overlay (or only those whose kind passes `filter`) and returns how many were asked to
 * close. Each entry is removed before its close function runs, so a second call (a double-tapped call button, two
 * session starts in the same tick, a close function that itself starts something) never closes the same overlay
 * twice, and an overlay that opens while this runs is left alone. A close function that throws doesn't stop the rest.
 */
export function closeAllOverlays(filter?: (kind: OverlayKind) => boolean): number {
  const snapshot = [...entries.entries()].filter(([, entry]) => !filter || filter(entry.kind));
  for (const [id] of snapshot) entries.delete(id);
  let closed = 0;
  for (const [, entry] of snapshot) {
    try {
      entry.close();
      closed++;
    } catch {
      // One overlay failing to close must not keep the call hidden behind the others.
    }
  }
  return closed;
}

/**
 * Whether starting this call session closes every open overlay: a new 1:1 / group call (renderer "direct", outgoing
 * or answered, an invite included) or a Collab / prebuilt call. Not the same session again (re-expanding a
 * minimized call, a double start), and not a live stream ("custom"), whose room keeps its own sheets (gift picker,
 * challenges) over its video and can restart its session mid-stream.
 */
export function sessionStartClosesOverlays(currentKey: string | null | undefined, next: { key: string; renderer?: string }): boolean {
  if (currentKey === next.key) return false;
  return next.renderer !== "custom";
}

/** How many overlays are registered right now (tests, diagnostics). */
export function openOverlayCount(): number {
  return entries.size;
}
