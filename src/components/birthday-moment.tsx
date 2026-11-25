"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { OverlayPortal, useOverlayZ } from "@/components/overlay-root";
import { UserAvatar } from "@/components/user-link";
import { useUiText } from "@/components/ui-text";
import {
  BIRTHDAY_MOMENT_INTRO_MS,
  BIRTHDAY_MOMENT_MAX_WISHES,
  BIRTHDAY_MOMENT_MAX_WISHES_LOW_END,
  BIRTHDAY_MOMENT_STAGES,
  focusWrapIndex,
  isEmojiOnlyWish,
  planBirthdayMoment,
  type BirthdayMomentPlan,
  type BirthdayMomentWish,
} from "@/lib/birthday-moment";
import { isLowEndDevice } from "@/lib/heart-burst";
import { registerOverlay } from "@/lib/overlay-registry";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { holdPageMedia, releasePageMedia } from "@/lib/video-playback-guard";
import { format } from "@/lib/i18n/locales";
import { cn } from "@/lib/utils";

/** If the back step that closes the moment never reports back (no popstate), close anyway after this long. */
const CLOSE_FALLBACK_MS = 800;
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
}

/**
 * The birthday moment: a full-screen cinematic reveal (planBirthdayMoment, CSS 3D in globals.css `.bday-*`).
 * - `celebrant`: the owner's, from their own profile on their birthday, with the wishes received so far as cards.
 * - `sender`: shown once a wish has been sent (it never waits for anything: the wish is already delivered), with that
 *   wish as its card.
 * Everything it says is real text: the headline names the dialog, a polite live region reads the summary, the cards
 * are a list. Closes on the X, a tap anywhere outside the cards and buttons, Escape and Back (one history entry of its
 * own, see useBackDismiss); every way out goes back through that entry first, so nothing is left behind in history.
 * Pauses whatever media plays behind it (holdPageMedia), and a starting call closes it (overlay registry).
 */
export function BirthdayMoment({
  variant,
  name,
  wishes,
  action,
  onClose,
}: {
  variant: "celebrant" | "sender";
  /** The person whose birthday it is. */
  name: string | null;
  wishes: BirthdayMomentWish[];
  /** Where the wishes can be read: the chat (sender) or Messages (celebrant). */
  action: { label: string; href: string };
  onClose: () => void;
}) {
  const { t: ui, dir, locale } = useUiText();
  const t = ui.birthdays;
  const m = t.moment;
  const router = useRouter();
  const z = useOverlayZ("viewer");
  const titleId = useId();
  const displayName = name ?? ui.unknownName;

  const [plan] = useState<BirthdayMomentPlan>(() => {
    const lowEnd = isLowEndDevice(typeof navigator === "undefined" ? undefined : navigator);
    const max = lowEnd ? BIRTHDAY_MOMENT_MAX_WISHES_LOW_END : BIRTHDAY_MOMENT_MAX_WISHES;
    return planBirthdayMoment(Math.random, {
      reduced: prefersReducedMotion(),
      lowEnd,
      cardCount: Math.min(wishes.length, max),
      rtl: dir === "rtl",
    });
  });
  const shown = wishes.slice(0, plan.cards.length);
  const [introDone, setIntroDone] = useState(plan.reduced);
  // Filled in after the dialog has opened, so the live region announces it as a change.
  const [announced, setAnnounced] = useState("");

  const title = format(variant === "celebrant" ? m.celebrantTitle : m.senderTitle, { name: displayName });
  const summary =
    variant === "celebrant" ? (shown.length > 0 ? m.celebrantSome : m.celebrantNone) : format(t.sent, { name: displayName });

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const closedRef = useRef(false);
  const pendingHrefRef = useRef<string | null>(null);
  const fallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    if (fallbackRef.current) clearTimeout(fallbackRef.current);
    onCloseRef.current();
    const href = pendingHrefRef.current;
    if (href) router.push(href);
  }, [router]);

  // Back closes it; any other way out steps back through the same entry first (finish runs on that popstate).
  useBackDismiss(true, finish);
  const requestClose = useCallback(
    (href?: string) => {
      if (closedRef.current || fallbackRef.current) return;
      pendingHrefRef.current = href ?? null;
      fallbackRef.current = setTimeout(finish, CLOSE_FALLBACK_MS);
      window.history.back();
    },
    [finish],
  );

  const dialogRef = useDialogFocus<HTMLDivElement>(true, () => requestClose());

  useEffect(() => {
    holdPageMedia();
    const unregister = registerOverlay(() => requestClose(), "other");
    const announce = setTimeout(() => setAnnounced(`${title} ${summary}`), 150);
    const intro = plan.reduced ? null : setTimeout(() => setIntroDone(true), BIRTHDAY_MOMENT_INTRO_MS);
    return () => {
      unregister();
      clearTimeout(announce);
      if (intro) clearTimeout(intro);
      releasePageMedia();
    };
    // Once per opening: the wording and plan don't change while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      if (fallbackRef.current) clearTimeout(fallbackRef.current);
    },
    [],
  );

  function onClick(e: MouseEvent<HTMLDivElement>) {
    // A portal still bubbles React events to whatever rendered it (a profile card, a list row).
    e.stopPropagation();
    if (e.target instanceof Element && e.target.closest("a, button, [data-bday-keep]")) return;
    requestClose();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const focusable = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const to = focusWrapIndex(focusable.indexOf(document.activeElement as HTMLElement), focusable.length, e.shiftKey);
    if (to === null) return;
    e.preventDefault();
    focusable[to].focus();
  }

  function onAction(e: MouseEvent<HTMLAnchorElement>) {
    // A plain click leaves through the moment's own history entry first, then opens the chat.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    requestClose(action.href);
  }

  return (
    <OverlayPortal z={z}>
      <div
        ref={dialogRef}
        role="dialog"
        // Also what keeps nav.tsx's swipe-between-tabs listener off any gesture made in here.
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        lang={locale}
        dir={dir}
        data-still={plan.reduced ? "" : undefined}
        data-low-end={plan.lowEnd ? "" : undefined}
        onClick={onClick}
        onKeyDown={onKeyDown}
        className="bday-moment fixed inset-0 outline-none"
        style={{ zIndex: z }}
      >
        <div className="bday-backdrop" aria-hidden />

        {!introDone && (
          <div className="bday-scene" aria-hidden>
            {!plan.lowEnd && (
              <>
                <span className="bday-streak" style={{ "--delay": `${BIRTHDAY_MOMENT_STAGES.risers}ms` } as CSSProperties} />
                <span
                  className="bday-streak"
                  data-alt=""
                  style={{ "--delay": `${BIRTHDAY_MOMENT_STAGES.particles}ms` } as CSSProperties}
                />
              </>
            )}
            {plan.risers.map((r) => (
              <span
                key={`r${r.id}`}
                className="bday-riser"
                style={
                  {
                    "--x": `${r.xPct}%`,
                    "--z": `${r.z}px`,
                    "--s": `${r.size}px`,
                    "--c": `var(--bday-c${r.color})`,
                    "--sway": `${r.sway}px`,
                    "--delay": `${r.delayMs}ms`,
                    "--dur": `${r.durationMs}ms`,
                  } as CSSProperties
                }
              />
            ))}
            {plan.particles.map((p) => (
              <span
                key={`p${p.id}`}
                className="bday-confetti"
                data-strip={p.strip ? "" : undefined}
                style={
                  {
                    "--x": `${p.xPct}%`,
                    "--s": `${p.size}px`,
                    "--c": `var(--bday-c${p.color})`,
                    "--drift": `${p.drift}px`,
                    "--spin": `${p.spin}deg`,
                    "--fall": p.fall,
                    "--delay": `${p.delayMs}ms`,
                    "--dur": `${p.durationMs}ms`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
        )}

        <div className="bday-camera relative mx-auto flex h-full max-w-md flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[calc(3.5rem+max(env(safe-area-inset-top),var(--status-bar-inset-top,0px)))]">
          <div className="relative text-center">
            <div className="bday-ribbon absolute inset-x-0 top-1/2 h-10 -translate-y-1/2 rounded-full opacity-40" aria-hidden />
            <h2 id={titleId} dir="auto" className="bday-name relative break-words px-2 font-display text-3xl font-semibold">
              {title}
            </h2>
          </div>
          <p dir="auto" className="bday-sub mt-3 text-center text-sm text-white/80">
            {summary}
          </p>
          <p className="sr-only" role="status" aria-live="polite">
            {announced}
          </p>

          <ul
            data-bday-keep=""
            className="bday-cards ph-no-capture mt-5 min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3"
            aria-labelledby={titleId}
          >
            {shown.map((wish, i) => {
              const card = plan.cards[i];
              return (
                <li
                  key={wish.id}
                  className="bday-card"
                  style={
                    {
                      "--ty": `${card.tiltY}deg`,
                      "--tx": `${card.tiltX}deg`,
                      "--z": `${card.z}px`,
                      "--delay": `${card.delayMs}ms`,
                      "--float-px": `${card.floatPx}px`,
                      "--float-ms": `${card.floatMs}ms`,
                    } as CSSProperties
                  }
                >
                  <div className={card.floatMs > 0 ? "bday-card-float" : undefined}>
                    <div className="rounded-2xl bg-white/95 p-4 text-start text-[#1c2420] shadow-[0_18px_40px_rgba(0,0,0,0.35)]">
                      <div className="flex items-center gap-2">
                        {variant === "celebrant" && (
                          <UserAvatar avatarUrl={wish.avatarUrl} name={wish.fromName} size={28} />
                        )}
                        <span dir="auto" className="min-w-0 truncate text-xs font-semibold text-[#55605a]">
                          {variant === "celebrant" ? format(m.from, { name: wish.fromName ?? ui.unknownName }) : m.fromYou}
                        </span>
                      </div>
                      <p
                        dir="auto"
                        className={cn("mt-2 whitespace-pre-wrap break-words", isEmojiOnlyWish(wish.text) ? "text-4xl" : "text-base")}
                      >
                        {wish.text}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div data-bday-keep="" className="bday-actions mt-4 flex gap-2">
            <a
              href={action.href}
              onClick={onAction}
              className="flex-1 rounded-full bg-accent px-4 py-2.5 text-center text-sm font-semibold text-accent-ink"
            >
              {action.label}
            </a>
            <button
              type="button"
              onClick={() => requestClose()}
              className="flex-1 rounded-full border border-white/40 px-4 py-2.5 text-sm font-semibold text-white"
            >
              {t.close}
            </button>
          </div>
          <p className="mt-3 text-center text-xs text-white/60" aria-hidden>
            {m.hint}
          </p>
        </div>

        <button
          type="button"
          onClick={() => requestClose()}
          aria-label={t.close}
          className="absolute end-4 top-[calc(1rem+max(env(safe-area-inset-top),var(--status-bar-inset-top,0px)))] rounded-full bg-black/40 p-2 text-white/80 hover:text-white"
        >
          <X size={24} aria-hidden />
        </button>
      </div>
    </OverlayPortal>
  );
}
