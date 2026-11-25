"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useReducedMotion } from "motion/react";
import { RotateCcw, Sparkles, X } from "lucide-react";
import { OverlayPortal, useOverlayZ } from "@/components/overlay-root";
import { GiftStage, useLowEndDevice } from "@/components/gift-stage";
import { useGiftsText } from "@/components/gifts-text";
import { focusWrapIndex } from "@/lib/birthday-moment";
import {
  giftEffectPlan,
  giftRevealArtSize,
  giftRevealTimeline,
  type GiftRevealSender,
  type GiftRevealStep,
} from "@/lib/gift-effect-plan";
import type { GiftTierName } from "@/lib/gift-market";
import { registerOverlay } from "@/lib/overlay-registry";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { holdPageMedia, releasePageMedia } from "@/lib/video-playback-guard";
import { format } from "@/lib/i18n/locales";

/** If the back step that closes the reveal never reports back (no popstate), close anyway after this long. */
const CLOSE_FALLBACK_MS = 800;
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Closes the reveal (through its own history entry first); `then` runs once it is gone. */
export type GiftRevealClose = (then?: () => void) => void;

const GiftRevealCloseContext = createContext<GiftRevealClose>(() => {});

/** For a button inside the reveal's `primary` / `secondary` / `details`: closes it, then runs `then`. */
export function useGiftRevealClose(): GiftRevealClose {
  return useContext(GiftRevealCloseContext);
}

function subscribeViewport(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}
const readArtSize = () => giftRevealArtSize({ width: window.innerWidth, height: window.innerHeight });

/**
 * THE gift reveal: one component for the marketplace's Preview (`mode="preview"`, a labelled sample sender and note)
 * and the recipient's open screen (`mode="recipient"`, via gift-open-overlay.tsx), so a buyer previews exactly what the
 * recipient will see. Full screen on a phone (dvh, safe areas, nothing scrolls the page), an expanded centred stage on
 * a tablet (sm) and a large two-column panel on a desktop (lg). The art plays in GiftStage (giftEffectPlan); the words
 * arrive in giftRevealTimeline's order and timing (header, tier badge, name, sender, note, buttons), Legendary slowest
 * and with a light sweep over its name. Reduced motion: everything at once with one short fade; a low-end device: the
 * lighter plan. Transform and opacity only (globals.css "Gift reveal").
 *
 * Pure presentation: no server action, no storage, no sound. What the buttons do is the caller's (`primary`,
 * `secondary`; useGiftRevealClose closes it from one of them). A dialog: focus moves in and is kept inside (Tab wraps), Escape, Back, the X and a tap outside the
 * panel close it (one history entry of its own, see useBackDismiss), a starting call closes it (overlay registry),
 * page media pauses while it is open, and a polite live region announces it.
 */
export function GiftReveal({
  mode,
  tier,
  items,
  giftName,
  sender,
  message,
  announcement,
  details,
  primary,
  secondary,
  onClose,
}: {
  mode: "preview" | "recipient";
  /** The marketplace rarity tier; a gift without one is revealed like a Common one, without a badge. */
  tier: GiftTierName | null;
  items: { slug: string; assetKey: string }[];
  giftName: string;
  /** "sample": the preview's labelled stand-in sender. */
  sender: GiftRevealSender | "sample";
  message: string | null;
  /** What the live region reads once it has opened (after the name and sender line). */
  announcement: string;
  /** Extra lines under the note (the box's contents, a preview's description and price). */
  details?: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  onClose: () => void;
}) {
  const { locale, dir, t } = useGiftsText();
  const m = t.market;
  const z = useOverlayZ("viewer");
  const titleId = useId();
  const reduce = useReducedMotion() ?? false;
  const lowEnd = useLowEndDevice();
  const artSize = useSyncExternalStore(subscribeViewport, readArtSize, () => 190);
  const stageTier = tier ?? "COMMON";
  const plan = giftEffectPlan(stageTier, { reduce, lowEnd });
  const timeline = giftRevealTimeline(plan, { hasMessage: Boolean(message) });
  const delays = new Map(timeline.steps.map((s) => [s.step, s.delayMs]));
  const step = (name: GiftRevealStep) => ({ "--step-delay": `${delays.get(name) ?? 0}ms` }) as CSSProperties;
  const [playKey, setPlayKey] = useState(0);
  const [announced, setAnnounced] = useState("");

  const senderLine =
    sender === "sample"
      ? format(t.open.senderLine, { name: m.preview.sampleSender })
      : sender.kind === "award"
        ? t.open.fromAward
        : sender.kind === "person"
          ? format(t.open.senderLine, { name: sender.label })
          : t.open.senderLineSomeone;

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const closedRef = useRef(false);
  const thenRef = useRef<(() => void) | null>(null);
  const fallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    if (fallbackRef.current) clearTimeout(fallbackRef.current);
    onCloseRef.current();
    const then = thenRef.current;
    // The next overlay (the marketplace's send sheet) opens only once this one is gone.
    if (then) requestAnimationFrame(() => then());
  }, []);

  // Back closes it; any other way out steps back through the same entry first (finish runs on that popstate).
  useBackDismiss(true, finish);
  const close = useCallback<GiftRevealClose>(
    (then) => {
      if (closedRef.current || fallbackRef.current) return;
      thenRef.current = then ?? null;
      fallbackRef.current = setTimeout(finish, CLOSE_FALLBACK_MS);
      window.history.back();
    },
    [finish],
  );

  const dialogRef = useDialogFocus<HTMLDivElement>(true, () => close());

  useEffect(() => {
    holdPageMedia();
    const unregister = registerOverlay(() => close(), "other");
    return () => {
      unregister();
      releasePageMedia();
    };
  }, [close]);

  useEffect(() => {
    // Filled in after the dialog has opened, so the live region announces it as a change.
    const timer = setTimeout(() => setAnnounced(`${giftName}. ${senderLine} ${announcement}`), 150);
    return () => clearTimeout(timer);
  }, [giftName, senderLine, announcement]);

  useEffect(
    () => () => {
      if (fallbackRef.current) clearTimeout(fallbackRef.current);
    },
    [],
  );

  useEffect(() => {
    // Replay remounts the words; keep the keyboard on the Replay button.
    if (playKey > 0) dialogRef.current?.querySelector<HTMLElement>("[data-reveal-replay]")?.focus({ preventScroll: true });
  }, [playKey, dialogRef]);

  function stop(e: { stopPropagation: () => void }) {
    // A portal still bubbles React events to whatever rendered it (a chat bubble, a list row, a grid card).
    e.stopPropagation();
  }

  function onClick(e: MouseEvent<HTMLDivElement>) {
    e.stopPropagation();
    if (e.target instanceof Element && e.target.closest("[data-reveal-panel]")) return;
    close();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const focusable = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const to = focusWrapIndex(focusable.indexOf(document.activeElement as HTMLElement), focusable.length, e.shiftKey);
    if (to === null) return;
    e.preventDefault();
    focusable[to].focus();
  }

  const safeTop = "max(env(safe-area-inset-top), var(--status-bar-inset-top, 0px))";
  return (
    <OverlayPortal z={z}>
      <GiftRevealCloseContext.Provider value={close}>
      <div
        ref={dialogRef}
        role="dialog"
        // Also what keeps nav.tsx's swipe-between-tabs listener off any gesture made in here.
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        lang={locale}
        dir={dir}
        onClick={onClick}
        onPointerDown={stop}
        onPointerUp={stop}
        onKeyDown={onKeyDown}
        className={`gift-reveal gift-tier-${stageTier.toLowerCase()} gift-reveal-${plan.motion} fixed inset-0 flex items-stretch justify-center overflow-hidden overscroll-none outline-none sm:items-center sm:p-6 lg:p-10`}
        style={{ zIndex: z, "--text-ms": `${timeline.textMs}ms` } as CSSProperties}
      >
        <div className="gift-reveal-backdrop absolute inset-0" aria-hidden />
        <div
          data-reveal-panel=""
          className="gift-reveal-panel relative flex h-full w-full flex-col overflow-hidden text-white sm:h-[min(92dvh,62rem)] sm:max-w-2xl sm:rounded-3xl sm:border sm:border-white/10 lg:h-[min(86dvh,46rem)] lg:max-w-6xl lg:flex-row"
        >
          <div className="relative flex min-h-36 flex-1 flex-col pt-[var(--reveal-safe-top)] sm:pt-0" style={{ "--reveal-safe-top": safeTop } as CSSProperties}>
            <GiftStage
              tier={stageTier}
              items={items}
              name={giftName}
              size={artSize}
              playKey={playKey}
              reduce={reduce}
              className="h-full w-full flex-1"
            />
          </div>

          <div
            key={playKey}
            className="gift-reveal-info relative flex min-h-0 shrink flex-col items-center gap-3 overflow-y-auto overscroll-contain px-6 pb-[max(1.25rem,env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px))] pt-4 text-center sm:px-10 sm:pb-8 lg:w-[28rem] lg:shrink-0 lg:justify-center lg:border-s lg:border-white/10 lg:py-10"
          >
            <p
              className="gift-reveal-step gift-reveal-header flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-white/85 sm:text-sm"
              style={step("header")}
            >
              <Sparkles size={16} aria-hidden className="gift-reveal-spark" />
              {t.open.congrats}
              <Sparkles size={16} aria-hidden className="gift-reveal-spark" />
            </p>
            {tier && (
              <span
                className="gift-reveal-step gift-tier-badge rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em]"
                style={step("badge")}
              >
                {format(m.preview.tierLabel, { tier: m.tiers[tier] })}
              </span>
            )}
            <h2
              id={titleId}
              dir="auto"
              className="gift-reveal-step gift-reveal-name relative max-w-full break-words font-display text-3xl font-bold uppercase leading-tight sm:text-4xl lg:text-5xl"
              style={step("name")}
            >
              {giftName}
              {timeline.nameShine && <span className="gift-reveal-shine" aria-hidden />}
            </h2>
            <p dir="auto" className="gift-reveal-step max-w-full break-words text-base text-white/90 sm:text-lg" style={step("sender")}>
              {senderLine}
            </p>
            {message && (
              <figure className="gift-reveal-step w-full max-w-sm" style={step("message")}>
                <figcaption className="text-[11px] font-semibold uppercase tracking-wider text-white/55">{t.open.messageHeading}</figcaption>
                <blockquote
                  dir="auto"
                  className="ph-no-capture mt-1 whitespace-pre-wrap break-words rounded-2xl bg-white/10 px-4 py-2.5 text-sm text-white"
                >
                  {message}
                </blockquote>
              </figure>
            )}
            <div className="gift-reveal-step flex w-full max-w-sm flex-col items-center gap-2" style={step("actions")}>
              {details}
              {primary}
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  data-reveal-replay=""
                  onClick={() => setPlayKey((k) => k + 1)}
                  className="flex h-10 items-center gap-1.5 rounded-full border border-white/30 px-4 text-sm font-medium text-white hover:border-white/60"
                >
                  <RotateCcw size={14} aria-hidden />
                  {t.open.replay}
                </button>
                {secondary}
              </div>
            </div>
          </div>

          {mode === "preview" && (
            <span
              className="absolute start-4 top-[calc(0.75rem+var(--reveal-safe-top))] rounded-full bg-black/55 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white sm:top-4"
              style={{ "--reveal-safe-top": safeTop } as CSSProperties}
            >
              {m.preview.previewBadge}
            </span>
          )}
          <button
            type="button"
            onClick={() => close()}
            aria-label={t.close}
            className="absolute end-3 top-[calc(0.5rem+var(--reveal-safe-top))] rounded-full bg-black/45 p-2 text-white/85 hover:text-white sm:top-3"
            style={{ "--reveal-safe-top": safeTop } as CSSProperties}
          >
            <X size={22} aria-hidden />
          </button>
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {announced}
        </p>
      </div>
      </GiftRevealCloseContext.Provider>
    </OverlayPortal>
  );
}
