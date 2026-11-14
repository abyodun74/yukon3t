"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { OVERLAY_LAYERS, OVERLAY_ROOT_ID, nestedLayer, type OverlayLayer } from "@/lib/overlay-layers";

/**
 * The single root host every overlay renders into, and the layer bookkeeping that goes with it.
 *
 * Why a portal at all: an overlay rendered inline sits inside whatever opened it, and `position: fixed` is only fixed
 * to the screen when no ancestor has a transform, filter, backdrop-filter, `contain`, `will-change: transform` or a
 * running transform animation. A Connections row (a lingering `transform` from its entrance animation) and a sheet's
 * blurred panel both are such ancestors, so a sheet or call dialog opened from them was positioned inside that row or
 * panel and painted under the content after it. Inline overlays were also inside the Home story tray's horizontal
 * scroller and inside stacking contexts (`relative z-[70]` wrappers) where their z-index only competed locally.
 * Everything in #overlay-root (a plain, unstyled last child of <body>) competes in body's stacking context only, with
 * the values of src/lib/overlay-layers.ts.
 *
 * React context and React events still flow through a portal as if it were inline; the DOM does not, which is why
 * `lang`/`dir` are carried over explicitly (OverlayLangProvider, set by EnglishOnly) instead of inherited.
 */

const OverlayLayerContext = createContext<number | null>(null);

type LangDir = { lang: string; dir: "ltr" | "rtl" };
const OverlayLangContext = createContext<LangDir | null>(null);

function subscribeNothing() {
  return () => {};
}

function findHost(): HTMLElement {
  return document.getElementById(OVERLAY_ROOT_ID) ?? document.body;
}

/** The overlay host once on the client; null on the server and during hydration (nothing to portal into yet). */
export function useOverlayHost(): HTMLElement | null {
  return useSyncExternalStore(subscribeNothing, findHost, () => null);
}

/** The z-index for an overlay of `layer` opened here: one above the overlay it was opened from, if any. */
export function useOverlayZ(layer: OverlayLayer): number {
  return nestedLayer(OVERLAY_LAYERS[layer], useContext(OverlayLayerContext));
}

/** The layer of the overlay this component is rendered in (null at page level). */
export function useParentOverlayLayer(): number | null {
  return useContext(OverlayLayerContext);
}

/** Marks a subtree as being inside an overlay at `z`, so overlays opened from it stack above it. */
export function OverlayLayerProvider({ z, children }: { z: number; children: ReactNode }) {
  return <OverlayLayerContext.Provider value={z}>{children}</OverlayLayerContext.Provider>;
}

/** The `lang`/`dir` an overlay should carry when the part of the page that opened it differs from <html>. */
export function useOverlayLang(): LangDir | null {
  return useContext(OverlayLangContext);
}

/** Set by EnglishOnly: overlays opened inside an English part of a translated page stay English and left-to-right. */
export function OverlayLangProvider({ lang, dir, children }: LangDir & { children: ReactNode }) {
  return <OverlayLangContext.Provider value={{ lang, dir }}>{children}</OverlayLangContext.Provider>;
}

/**
 * Renders `children` into the root overlay host, marked as being at layer `z` (so anything they open stacks above).
 * Renders nothing on the server and in the hydration pass; the overlay appears on the next client render.
 */
export function OverlayPortal({ z, children }: { z: number; children: ReactNode }) {
  const host = useOverlayHost();
  if (!host) return null;
  return createPortal(<OverlayLayerContext.Provider value={z}>{children}</OverlayLayerContext.Provider>, host);
}
