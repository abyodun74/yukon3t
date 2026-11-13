"use client";

import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { GiftArt } from "@/components/gift-art";
import { GiftLottie } from "@/components/gift-lottie";
import { resolveGiftAnimation } from "@/lib/gift-assets";
import { useGiftsText } from "@/components/gifts-text";
import { useChallengesText } from "@/components/challenges-text";
import { getLiveGiftEffects } from "@/app/actions/gifts";
import { getLiveChallengeMoments } from "@/app/actions/challenges";
import { LIVE_GIFT_EFFECT_MS, createGiftEffectQueue } from "@/lib/gifts";
import { CHALLENGE_WINNER_EFFECT } from "@/lib/challenges";
import { format, plural } from "@/lib/i18n/locales";

/** One thing the layer plays: a gift effect, or (Phase B) a challenge's winner moment, which carries its wording. */
type LayerEffect = { id: string; effect: string; title?: string; winnerCount?: number; youWon?: boolean };

/**
 * Effects over a live stream: digital-gift effects (src/lib/gifts.ts) and, from Gift Universe Phase B, a challenge's
 * "winner moment" (src/lib/challenges.ts). A plain DOM layer on top of the video: it never touches the Daily call
 * object (there is only ever one Daily instance, owned by the live frame). A `giftSignal` bump (a "gift" live-stream
 * signal, or joining) asks getLiveGiftEffects what arrived in the last few seconds; a `challengeSignal` bump (a
 * "challenge" signal) asks getLiveChallengeMoments for results declared in the last few seconds. Both feed ONE queue
 * (createGiftEffectQueue), so only one effect ever plays at a time, each at most LIVE_GIFT_EFFECT_MS (3.2 s). Names
 * nobody: who sent a gift to whom, or who won, is never shown here (a winner moment says the challenge's title, how many
 * won, and "You won" to a winner). Reduced motion: a still picture and a line of text instead of the animation.
 */
export function LiveGiftLayer({
  liveStreamId,
  signal,
  challengeSignal = 0,
  gifts = true,
  challenges = false,
}: {
  liveStreamId: string;
  signal: number;
  challengeSignal?: number;
  /** Gifts are on for the viewer (giftsEnabledFor). */
  gifts?: boolean;
  /** Challenges are on for the viewer (challengesEnabledFor). */
  challenges?: boolean;
}) {
  const { locale, dir, t } = useGiftsText();
  const { t: ct } = useChallengesText();
  const reduce = useReducedMotion();
  const [current, setCurrent] = useState<LayerEffect | null>(null);
  // One queue for the life of the room. Its timer lives in the same closure (not a ref), so nothing here is read
  // during render.
  const [player] = useState(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const queue = createGiftEffectQueue<LayerEffect>((effect) => {
      setCurrent(effect);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        setCurrent(null);
        queue.done();
      }, LIVE_GIFT_EFFECT_MS);
    });
    return {
      queue,
      stop() {
        if (timer) clearTimeout(timer);
        queue.clear();
      },
    };
  });

  useEffect(() => () => player.stop(), [player]);

  useEffect(() => {
    if (!gifts) return undefined;
    let cancelled = false;
    getLiveGiftEffects(liveStreamId)
      .then((result) => {
        if (!cancelled && result.error === null) player.queue.push(result.effects);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [liveStreamId, signal, player, gifts]);

  useEffect(() => {
    if (!challenges) return undefined;
    let cancelled = false;
    getLiveChallengeMoments(liveStreamId)
      .then((result) => {
        if (!cancelled && result.error === null) player.queue.push(result.moments);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [liveStreamId, challengeSignal, player, challenges]);

  const isMoment = current?.effect === CHALLENGE_WINNER_EFFECT;
  const announce = !current
    ? ""
    : isMoment
      ? format(ct.moment.announce, { title: current.title ?? "" })
      : t.live.effectArrived;

  return (
    <div lang={locale} dir={dir} className="pointer-events-none fixed inset-0 z-[65] overflow-hidden">
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      {current &&
        (isMoment ? (
          <WinnerMoment key={current.id} moment={current} reduce={Boolean(reduce)} />
        ) : (
          <Effect key={current.id} effect={current.effect} reduce={Boolean(reduce)} label={t.live.effectArrived} />
        ))}
    </div>
  );
}

/**
 * A challenge's winner moment: one card that fades and rises in, holds, and fades out within LIVE_GIFT_EFFECT_MS. No
 * flashing (a single fade in and out, nothing repeats), and a still card with reduced motion.
 */
function WinnerMoment({ moment, reduce }: { moment: LayerEffect; reduce: boolean }) {
  const { locale, dir, t } = useChallengesText();
  const card = (
    <div
      lang={locale}
      dir={dir}
      className="mx-auto flex max-w-[80vw] flex-col items-center gap-1 rounded-2xl bg-black/70 px-5 py-4 text-center text-white backdrop-blur-md"
    >
      <GiftArt assetKey={CHALLENGE_WINNER_EFFECT} name={t.moment.title} size={reduce ? 56 : 72} eager />
      <p className="text-base font-semibold">{moment.youWon ? t.moment.you : t.moment.title}</p>
      {moment.title && (
        <p dir="auto" className="max-w-full truncate text-sm text-white/85">
          {moment.title}
        </p>
      )}
      {typeof moment.winnerCount === "number" && moment.winnerCount > 0 && (
        <p className="text-xs text-white/70">{plural(locale, t.moment.winners, moment.winnerCount)}</p>
      )}
    </div>
  );
  if (reduce) return <div className="absolute inset-x-0 top-1/3 flex justify-center px-4">{card}</div>;
  return (
    <m.div
      className="absolute inset-x-0 top-1/3 flex justify-center px-4"
      initial={{ opacity: 0, y: 24, scale: 0.94 }}
      animate={{ opacity: [0, 1, 1, 0], y: [24, 0, 0, -12], scale: [0.94, 1, 1, 1] }}
      transition={{ duration: 3, times: [0, 0.15, 0.85, 1], ease: "easeOut" }}
    >
      {card}
    </m.div>
  );
}

const CONFETTI_COLORS = ["#E8335A", "#3B7DC9", "#3E8E50", "#F6B73C", "#7B5CE6", "#E46FB0"];

function Effect({ effect, reduce, label }: { effect: string; reduce: boolean; label: string }) {
  // Pieces are laid out once per effect (stable across re-renders), from a deterministic spread.
  const pieces = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        left: ((i * 37) % 100) + (i % 3) * 0.7,
        delay: (i % 7) * 0.08,
        rotate: (i * 47) % 360,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      })),
    [],
  );

  if (reduce) {
    return (
      <div className="absolute inset-x-0 top-1/3 flex flex-col items-center gap-2">
        <GiftArt assetKey={effect} name={label} size={72} eager />
        <span className="rounded-full bg-black/60 px-3 py-1 text-sm text-white">{label}</span>
      </div>
    );
  }

  // A Lottie live effect (Phase A, e.g. Level Up): at most LIVE_GIFT_EFFECT_MS long and never flashing more than three
  // times a second (both checked for every file by gift-assets.test.ts); the queue's timer ends it either way.
  if (resolveGiftAnimation(effect)) {
    return (
      <div className="absolute inset-x-0 top-1/4 flex justify-center">
        <GiftLottie assetKey={effect} name={label} size={220} reduce={false} />
      </div>
    );
  }

  if (effect === "confetti") {
    return (
      <>
        {pieces.map((piece, i) => (
          <m.span
            key={i}
            className="absolute top-0 block h-2.5 w-1.5 rounded-sm"
            style={{ left: `${piece.left}%`, backgroundColor: piece.color }}
            initial={{ y: "-5vh", rotate: piece.rotate, opacity: 1 }}
            animate={{ y: "105vh", rotate: piece.rotate + 540, opacity: [1, 1, 0.2] }}
            transition={{ duration: 2.6, delay: piece.delay, ease: "easeIn" }}
          />
        ))}
      </>
    );
  }

  if (effect === "aurora-sweep") {
    return (
      <m.div
        className="absolute inset-y-0 w-[60vw]"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(52,227,176,0.35), rgba(79,163,255,0.4), rgba(178,107,255,0.35), transparent)",
          filter: "blur(18px)",
        }}
        initial={{ x: "-70vw", opacity: 0 }}
        animate={{ x: "110vw", opacity: [0, 1, 1, 0] }}
        transition={{ duration: 3, ease: "easeInOut" }}
      />
    );
  }

  return (
    <m.div
      className="absolute inset-x-0 top-1/3 flex justify-center"
      initial={{ scale: 0.4, opacity: 0, y: 40 }}
      animate={{ scale: [0.4, 1.15, 1], opacity: [0, 1, 1, 0], y: [40, 0, 0, -30] }}
      transition={{ duration: 2.6, times: [0, 0.3, 0.8, 1] }}
    >
      <GiftArt assetKey={effect} name={label} size={96} eager />
    </m.div>
  );
}
