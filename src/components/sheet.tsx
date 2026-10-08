"use client";

import { AnimatePresence, motion, type PanInfo } from "motion/react";
import { X } from "lucide-react";
import { useId, type ReactNode } from "react";
import { hapticImpact } from "@/lib/haptics";
import { useDialogFocus } from "@/lib/use-dialog-focus";

type SheetVariant = "dialog" | "bottom-sheet";

/**
 * Shared chrome for every modal/dialog in the app — replaces each one
 * hand-rolling its own backdrop + panel + open/close mechanics (share,
 * report, likers, recorders, channel settings, the muse composer, etc.;
 * see the apple-design skill's "spatial consistency"/"materials" sections
 * for why this needed to be one component, not ~20 slightly-different
 * ones). Two things no amount of per-component CSS tweaking could fix on
 * its own:
 *
 * - A real exit animation. The old `.animate-modal-panel-in` CSS class
 *   (still used by anything not yet migrated onto this) only ever played
 *   on mount — `onClose` just unmounted the component, so every modal
 *   popped in smoothly and vanished instantly. AnimatePresence here keeps
 *   the panel mounted for exactly as long as its exit animation takes,
 *   and that exit mirrors the entrance (HIG's "enters and exits along the
 *   same path").
 * - A real material. `.hig-material` (globals.css) + backdrop-blur
 *   instead of a flat `bg-surface`, with the reduced-transparency/
 *   contrast fallback that marker class already wires up.
 *
 * `variant="bottom-sheet"` adds a drag-to-dismiss handle — `drag`/
 * `dragElastic` below are motion's own built-in rubber-banding and
 * velocity tracking, not hand-rolled physics; `dragMomentum` (on by
 * default) is what gives a fast downward flick its own inertia instead of
 * stopping the instant the pointer lifts. Dragging is never the only way
 * out, though (Voice Control and VoiceOver users can't perform it): a
 * titled sheet has its own Close button, Escape closes any sheet, and an
 * untitled one is expected to render its own cancel/dismiss button.
 *
 * Accessibility lives here too, so all ~20 callers get it at once: the
 * dialog is named after its title (or `ariaLabel`, for a sheet that renders
 * its own heading), focus moves into it on open and back to whatever opened
 * it on close — see useDialogFocus.
 */
export function Sheet({
  open,
  onClose,
  variant = "dialog",
  responsive = false,
  title,
  ariaLabel,
  children,
  panelClassName,
}: {
  open: boolean;
  onClose: () => void;
  variant?: SheetVariant;
  /** bottom-sheet only: becomes a centered dialog at the `sm` breakpoint instead of staying bottom-anchored — same responsive switch muse-composer.tsx/review-prompt-gate.tsx's own hand-rolled modals used (a touch-first bottom sheet makes less sense once there's a mouse pointer and real screen width). Drag-to-dismiss stays active at every width — harmless on desktop, just rarely used there. */
  responsive?: boolean;
  /** Omit for a panel that renders its own heading — not every migrated modal used a plain string title. */
  title?: ReactNode;
  /** Accessible name for a sheet with no `title` (one that renders its own heading, or none at all) — ignored when `title` is set, since the visible title already names the dialog. */
  ariaLabel?: string;
  children: ReactNode;
  /** Extra width/sizing classes for the panel — each modal's own content decides this (max-w-sm vs max-w-md, etc.). */
  panelClassName?: string;
}) {
  const titleId = useId();
  const dialogRef = useDialogFocus<HTMLDivElement>(open, onClose);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={dialogRef}
          className={
            variant === "bottom-sheet"
              ? `fixed inset-0 z-50 flex items-end justify-center bg-black/60 outline-none ${responsive ? "sm:items-center sm:p-4" : ""}`
              : // items-start + the panel's own my-auto (see DialogPanel), not
                // items-center: both center a panel that fits, but when the
                // panel is taller than the screen (a long form at a large
                // iOS text size) items-center pushes its top — the title and
                // Close button — above the viewport where no scroll can
                // reach it. Auto margins collapse to 0 instead, so the panel
                // starts at the top and this backdrop scrolls to the rest.
                "fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/60 p-4 outline-none"
          }
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title !== undefined ? titleId : undefined}
          aria-label={title !== undefined ? undefined : ariaLabel}
          tabIndex={-1}
        >
          {variant === "bottom-sheet" ? (
            <BottomSheetPanel onClose={onClose} title={title} titleId={titleId} responsive={responsive} panelClassName={panelClassName}>
              {children}
            </BottomSheetPanel>
          ) : (
            <DialogPanel onClose={onClose} title={title} titleId={titleId} panelClassName={panelClassName}>
              {children}
            </DialogPanel>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Critically damped (no overshoot) — the apple-design skill's default for
// anything that didn't arrive via a flick/drag of its own. A plain fade+
// scale from the panel's own center (not a fixed offset), same spatial
// idea as a popover scaling from its trigger rather than an arbitrary
// corner.
const DIALOG_SPRING = { type: "spring" as const, damping: 1, duration: 0.35 };

function DialogPanel({
  onClose,
  title,
  titleId,
  panelClassName,
  children,
}: {
  onClose: () => void;
  title?: ReactNode;
  titleId: string;
  panelClassName?: string;
  children: ReactNode;
}) {
  // panelClassName appends rather than truly overrides (two same-specificity
  // Tailwind classes setting the same property resolve by generated-CSS
  // order, not source order, so appending a conflicting max-w-* after the
  // base one here would be unreliable either way) — dropping the base
  // max-w-sm whenever the caller supplies its own is what actually makes
  // a width override behave predictably.
  const widthOverride = panelClassName?.includes("max-w-");
  return (
    <motion.div
      className={`hig-material my-auto w-full ${widthOverride ? "" : "max-w-sm"} rounded-xl border border-line bg-surface/90 p-4 backdrop-blur-xl ${panelClassName ?? ""}`}
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.97 }}
      transition={DIALOG_SPRING}
      onClick={(e) => e.stopPropagation()}
    >
      {title !== undefined && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 id={titleId} className="min-w-0 text-sm font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 text-foreground-soft hover:text-danger">
            <X size={18} aria-hidden />
          </button>
        </div>
      )}
      {children}
    </motion.div>
  );
}

// Slightly underdamped — the apple-design skill's own "drawer/sheet"
// reference row (damping ~0.8, response ~0.3): a little settle motion
// feels right here specifically because a bottom sheet's enter is a
// physical "arriving" motion, not a static element fading into place.
const SHEET_SPRING = { type: "spring" as const, damping: 0.8, duration: 0.3 };
// Past this downward drag distance (or a fast-enough downward flick,
// DISMISS_VELOCITY below, regardless of distance), the sheet dismisses
// instead of springing back — same "use velocity, not just position, to
// decide reverse vs. commit" rule as the skill's Quick Reference table.
const DISMISS_DISTANCE_PX = 120;
const DISMISS_VELOCITY_PX_PER_S = 800;

function BottomSheetPanel({
  onClose,
  title,
  titleId,
  responsive,
  panelClassName,
  children,
}: {
  onClose: () => void;
  title?: ReactNode;
  titleId: string;
  responsive?: boolean;
  panelClassName?: string;
  children: ReactNode;
}) {
  // Only handles the DISMISS decision — a non-dismissing release needs no
  // code of its own: dragConstraints={{top:0, bottom:0}} already makes
  // motion auto-spring the panel back to y:0 the instant the drag ends,
  // same as any native sheet's "didn't drag far/fast enough" snap-back.
  function handleDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.y > DISMISS_DISTANCE_PX || info.velocity.y > DISMISS_VELOCITY_PX_PER_S) {
      hapticImpact("light");
      onClose();
    }
  }

  // Same override-vs-append reasoning as DialogPanel's own widthOverride.
  const widthOverride = panelClassName?.includes("max-w-");
  return (
    <motion.div
      className={`hig-material w-full ${widthOverride ? "" : "max-w-lg"} rounded-t-2xl border-t border-x border-line bg-surface/90 backdrop-blur-xl ${responsive ? "sm:rounded-2xl sm:max-w-sm" : ""} ${panelClassName ?? ""}`}
      style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={SHEET_SPRING}
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      // Free movement downward (1 = no added resistance — there's really
      // nothing below to "hold it back" except the dismiss decision
      // itself), real rubber-band resistance upward (there's nowhere
      // further up to reveal, so dragging up should visibly push back).
      dragElastic={{ top: 0.15, bottom: 1 }}
      onDragEnd={handleDragEnd}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Drag handle — a visual affordance, not the only draggable area;
          the whole panel is the drag target (motion's `drag` prop above
          applies to this entire motion.div), matching how a real iOS
          sheet can be dragged from its header, not just a tiny grabber. */}
      <div className="flex justify-center pb-1 pt-2" aria-hidden>
        <div className="h-1 w-9 rounded-full bg-foreground-soft/30" />
      </div>
      {title !== undefined && (
        <div className="flex items-center justify-between gap-2 px-4 pb-2">
          <h2 id={titleId} className="min-w-0 text-sm font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 text-foreground-soft hover:text-danger">
            <X size={18} aria-hidden />
          </button>
        </div>
      )}
      <div className="px-4 pb-4">{children}</div>
    </motion.div>
  );
}
