"use client";

import { useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { GiftArt } from "@/components/gift-art";
import { giftEffectPlan } from "@/lib/gift-effect-plan";
import type { GiftTierName } from "@/lib/gift-market";
import {
  BALLOON_ANCHOR,
  BALLOON_BOX,
  HEARTBEAT_CENTER,
  HEARTBEAT_LINE,
  HIGH_FIVE_CONTACT,
  WAVE_PIVOT,
  giftSignaturePlan,
  highFiveClips,
  type GiftSignatureKind,
  type SignatureParticle,
} from "@/lib/gift-signature-motion";

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
const origin = (p: { x: number; y: number }) => ({ transformOrigin: `${pct(p.x)} ${pct(p.y)}` });

/**
 * A gift's signature motion (src/lib/gift-signature-motion.ts: Wave, High five, Birthday Balloons, Confetti, the
 * Heartbeat Note's pulse) in place of the stage's generic entrance: GiftStage
 * renders it for the gifts in GIFT_SIGNATURES, so the marketplace Preview and the recipient's open screen play the same
 * thing. Decorative (the stage is aria-hidden). Each layer carries a `data-sig` id; on mount every layer with a track is
 * animated with the Web Animations API (transform and opacity only, finite, fill "backwards"), and every animation is
 * cancelled on unmount, so closing the reveal stops it at once and Replay (GiftStage remounts this) starts it over.
 * Without a track (reduced motion, a low-end device's lighter plan) a layer sits in its final pose from globals.css
 * ("Gift signature motions"): the gift's plain art at rest, transient layers hidden.
 */
export function GiftSignatureMotion({
  kind,
  tier,
  reduce,
  lowEnd,
  assetKey,
  name,
  size,
}: {
  kind: GiftSignatureKind;
  tier: GiftTierName;
  reduce: boolean;
  lowEnd: boolean;
  assetKey: string;
  name: string;
  size: number;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const plan = useMemo(
    () => giftSignaturePlan(kind, giftEffectPlan(tier, { reduce, lowEnd }), size),
    [kind, tier, reduce, lowEnd, size],
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const running: Animation[] = [];
    for (const el of root.querySelectorAll<HTMLElement>("[data-sig]")) {
      const track = plan.tracks[el.dataset.sig ?? ""];
      if (!track || typeof el.animate !== "function") continue;
      running.push(
        el.animate(track.keyframes, {
          delay: track.delayMs,
          duration: track.durationMs,
          iterations: track.iterations,
          fill: "backwards",
          easing: "linear",
        }),
      );
    }
    return () => {
      for (const animation of running) animation.cancel();
    };
  }, [plan]);

  const art = <GiftArt assetKey={assetKey} name={name} size={size} eager />;
  const moving = plan.motion !== "still";
  const has = (id: string) => id in plan.tracks;

  return (
    <span ref={rootRef} className={`gift-sig gift-sig-${kind}`} style={{ width: size, height: size }} data-signature={kind}>
      {kind === "wave" && (
        <>
          <span data-sig="art" className="gift-sig-layer">
            <span data-sig="swing" className="gift-sig-layer gift-sig-wave-hand" style={origin(WAVE_PIVOT)}>
              {art}
            </span>
          </span>
          {has("linesEnd") && (
            <span data-sig="linesEnd" className="gift-sig-fx gift-sig-lines gift-sig-lines-end">
              <span className="gift-sig-arc" />
              <span className="gift-sig-arc gift-sig-arc-outer" />
            </span>
          )}
          {has("linesStart") && (
            <span data-sig="linesStart" className="gift-sig-fx gift-sig-lines gift-sig-lines-start">
              <span className="gift-sig-arc" />
              <span className="gift-sig-arc gift-sig-arc-outer" />
            </span>
          )}
        </>
      )}

      {kind === "high-five" && (
        <>
          <span data-sig="art" className="gift-sig-layer">
            {art}
          </span>
          {moving && <HighFiveHalves art={art} />}
          {has("flash") && (
            <span
              data-sig="flash"
              className="gift-sig-fx gift-sig-flash"
              style={{ left: pct(HIGH_FIVE_CONTACT.x), top: pct(HIGH_FIVE_CONTACT.y) }}
            />
          )}
          {has("ring") && (
            <span
              data-sig="ring"
              className="gift-sig-fx gift-sig-ring"
              style={{ left: pct(HIGH_FIVE_CONTACT.x), top: pct(HIGH_FIVE_CONTACT.y) }}
            />
          )}
        </>
      )}

      {kind === "balloon-release" && (
        <>
          <span data-sig="art" className="gift-sig-layer" style={origin(BALLOON_ANCHOR)}>
            <span data-sig="hover" className="gift-sig-layer">
              <span data-sig="sway" className="gift-sig-layer" style={origin(BALLOON_ANCHOR)}>
                {art}
              </span>
            </span>
          </span>
          {moving && (
            <>
              <span
                data-sig="box"
                className="gift-sig-fx gift-sig-box"
                style={{
                  left: pct(BALLOON_BOX.x - BALLOON_BOX.width / 2),
                  top: pct(BALLOON_BOX.top),
                  width: pct(BALLOON_BOX.width),
                  height: pct(BALLOON_BOX.height),
                }}
              >
                <GiftBoxBody />
              </span>
              <span
                data-sig="lid"
                className="gift-sig-fx gift-sig-lid"
                style={{
                  left: pct(BALLOON_BOX.x - (BALLOON_BOX.width * 1.12) / 2),
                  top: pct(BALLOON_BOX.top - BALLOON_BOX.height * 0.42),
                  width: pct(BALLOON_BOX.width * 1.12),
                  height: pct(BALLOON_BOX.height * 0.5),
                }}
              >
                <GiftBoxLid />
              </span>
            </>
          )}
        </>
      )}

      {kind === "confetti-rise" && (
        <span data-sig="art" className="gift-sig-layer">
          {art}
        </span>
      )}

      {kind === "heartbeat" && (
        <>
          <span data-sig="art" className="gift-sig-layer">
            <span data-sig="beat" className="gift-sig-layer" style={origin(HEARTBEAT_CENTER)}>
              {art}
            </span>
          </span>
          {has("glow") && (
            <span
              data-sig="glow"
              className="gift-sig-fx gift-sig-heart-glow"
              style={{ left: pct(HEARTBEAT_CENTER.x), top: pct(HEARTBEAT_CENTER.y) }}
            />
          )}
          {Object.keys(plan.tracks)
            .filter((id) => id.startsWith("ring"))
            .map((id) => (
              <span
                key={id}
                data-sig={id}
                className="gift-sig-fx gift-sig-heart-ring"
                style={{ left: pct(HEARTBEAT_CENTER.x), top: pct(HEARTBEAT_CENTER.y) }}
              />
            ))}
          {Object.keys(plan.tracks)
            .filter((id) => id.startsWith("trace"))
            .map((id) => (
              <span
                key={id}
                data-sig={id}
                className="gift-sig-fx gift-sig-heart-trace"
                style={{ left: pct(HEARTBEAT_LINE.from), top: pct(HEARTBEAT_LINE.y) }}
              />
            ))}
        </>
      )}

      {plan.particles.map((p) => (
        <Particle key={p.id} particle={p} />
      ))}
    </span>
  );
}

/** The High five art twice, each copy clipped to one hand; they meet exactly where the clips touch. */
function HighFiveHalves({ art }: { art: ReactNode }) {
  const clips = highFiveClips();
  return (
    <>
      <span
        data-sig="halfStart"
        className="gift-sig-fx gift-sig-layer"
        style={{ clipPath: clips.start, WebkitClipPath: clips.start, transformOrigin: "25% 100%" }}
      >
        {art}
      </span>
      <span
        data-sig="halfEnd"
        className="gift-sig-fx gift-sig-layer"
        style={{ clipPath: clips.end, WebkitClipPath: clips.end, transformOrigin: "75% 100%" }}
      >
        {art}
      </span>
    </>
  );
}

function Particle({ particle: p }: { particle: SignatureParticle }) {
  const style: CSSProperties = {
    left: pct(p.x),
    top: pct(p.y),
    width: p.width,
    height: p.height,
    marginLeft: -p.width / 2,
    marginTop: -p.height / 2,
    background: p.color,
  };
  return <span data-sig={p.id} className={`gift-sig-fx gift-sig-particle gift-sig-particle-${p.shape}`} style={style} />;
}

/** A simple gift box (no art file): body with a ribbon, and a lid with a bow that pops off. */
function GiftBoxBody() {
  return (
    <svg viewBox="0 0 100 66" preserveAspectRatio="none" aria-hidden focusable={false} className="block h-full w-full">
      <rect x="2" y="0" width="96" height="66" rx="5" fill="#7a3ce0" />
      <rect x="2" y="0" width="96" height="10" fill="#5b2ab3" />
      <rect x="62" y="0" width="36" height="66" rx="0" fill="#000" opacity="0.14" />
      <rect x="43" y="0" width="14" height="66" fill="#ffcc4d" />
      <rect x="43" y="0" width="4" height="66" fill="#fff3c4" opacity="0.7" />
    </svg>
  );
}

function GiftBoxLid() {
  return (
    <svg viewBox="0 0 112 33" aria-hidden focusable={false} className="block h-full w-full" preserveAspectRatio="none">
      <path d="M56 15 C44 1 28 2 32 11 C35 17 48 16 56 15 Z" fill="#ffcc4d" />
      <path d="M56 15 C68 1 84 2 80 11 C77 17 64 16 56 15 Z" fill="#ffb627" />
      <rect x="0" y="14" width="112" height="19" rx="4" fill="#9455f2" />
      <rect x="0" y="27" width="112" height="6" fill="#000" opacity="0.16" />
      <rect x="49" y="14" width="14" height="19" fill="#ffcc4d" />
    </svg>
  );
}
