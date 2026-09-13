import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Pairs with globals.css's .img-fade-in/.img-loaded — an <img> starts at
 * opacity 0 and fades in once loaded, so it reveals from its own
 * placeholder background instead of popping straight in. A plain onLoad
 * handler alone isn't enough: if the browser already has the image cached,
 * it can load (and fire the load event) before React ever attaches the
 * listener, leaving the image stuck invisible forever — this ref callback
 * covers that by checking `.complete` the moment the element mounts, in
 * addition to whatever onLoad the caller also wires up for the normal
 * loads-after-mount case.
 */
export function markImageLoadedIfComplete(el: HTMLImageElement | null) {
  if (el?.complete) el.classList.add("img-loaded");
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}
