"use client";

import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { GiftArt } from "@/components/gift-art";
import { GiftLottie } from "@/components/gift-lottie";
import { resolveGiftAnimation } from "@/lib/gift-assets";
import { useGiftsText } from "@/components/gifts-text";
import { getLiveGiftEffects } from "@/app/actions/gifts";
import { LIVE_GIFT_EFFECT_MS, createGiftEffectQueue } from "@/lib/gifts";

/**
 * Digital-gift effects over a live stream (src/lib/gifts.ts). A plain DOM layer on top of the video: it never
 * touches the Daily call object (there is only ever one Daily instance, owned by the live frame). Each `signal` bump
 * (the room heard a "gift" live-stream signal, or joined) asks getLiveGiftEffects what arrived in the last few
 * seconds; effects then play one at a time from a small queue (createGiftEffectQueue). Names nobody: who sent a gift
 * to whom is never shown here. Reduced motion: a still picture and a line of text instead of the animation.
 */
export function LiveGiftLayer({ liveStreamId, signal }: { liveStreamId: string; signal: number }) {
  const { locale, dir, t } = useGiftsText();
  const reduce = useReducedMotion();
  const [current, setCurrent] = useState<{ id: string; effect: string } | null>(null);
  // One queue for the life of the room. Its timer lives in the same closure (not a ref), so nothing here is read
  // during render.
  const [player] = useState(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const queue = createGiftEffectQueue((effect) => {
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
    let cancelled = false;
    getLiveGiftEffects(liveStreamId)
      .then((result) => {
        if (!cancelled && result.error === null) player.queue.push(result.effects);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [liveStreamId, signal, player]);

  return (
    <div lang={locale} dir={dir} className="pointer-events-none fixed inset-0 z-[65] overflow-hidden">
      <p className="sr-only" aria-live="polite">
        {current ? t.live.effectArrived : ""}
      </p>
      {current && <Effect key={current.id} effect={current.effect} reduce={Boolean(reduce)} label={t.live.effectArrived} />}
    </div>
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
