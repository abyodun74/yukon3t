import { cn } from "@/lib/utils";

/**
 * Profile pictures are not saveable from inside the app: no save/share
 * control is offered for them, and this removes the browser's own casual
 * paths (right-click "Save image as…", the long-press "Save image" /
 * "Download image" callout, dragging the image out). It is a deterrent
 * only. Anything shown on screen can still be screenshotted, and the image
 * is still an ordinary public URL that devtools or a direct fetch can reach.
 *
 * `protected-image` (globals.css) adds the CSS half: no touch callout, no
 * selection, no `-webkit-user-drag` (not in React's CSS types, hence a class).
 * Clicks and taps are untouched, so an avatar inside a link or button still
 * activates it. Same technique as the view-once viewer.
 */
export const PROTECTED_IMAGE_CLASS = "protected-image";

export function blockImageSave(e: { preventDefault: () => void }): void {
  e.preventDefault();
}

/** Spread onto an `<img>` (pass its own classes in) to make it non-saveable. */
export function protectedImageProps(className?: string) {
  return {
    draggable: false,
    onContextMenu: blockImageSave,
    onDragStart: blockImageSave,
    className: cn(PROTECTED_IMAGE_CLASS, className),
  } as const;
}
