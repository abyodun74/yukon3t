"use client";

import type { DailyCall } from "@daily-co/daily-js";

/**
 * Lets the CALLER side of a 1:1 call join the Daily room the moment it
 * starts ringing, instead of only starting to connect once the callee
 * actually taps Accept (what both sides used to do — see DirectCallFrame).
 * The callee can't do the equivalent (joining before they've agreed to the
 * call would start sending their own media into a room the caller is
 * already in, with no consent yet), but the caller placing the call has
 * already consented by placing it — so the whole ring duration (up to
 * ~55s, see CallForegroundService.RING_TIMEOUT_MS) is idle time that can
 * absorb the same daily-js-fetch + getUserMedia + WebRTC-handshake cost
 * DirectCallFrame would otherwise only start paying once Accept is tapped.
 * By the time the callee accepts, the caller is often already sitting
 * connected in the room — DirectCallFrame then adopts this object (see
 * takePrewarmedCall) instead of creating and joining its own from scratch.
 *
 * Keyed by the same `call:${callId}` string call-session.tsx already uses
 * as its own session dedupe key, not a separate identifier — see
 * call-button.tsx/incoming-call-listener.tsx.
 */
type PrewarmEntry = { promise: Promise<DailyCall> };

const prewarmed = new Map<string, PrewarmEntry>();

export function prewarmCall(
  key: string,
  { roomUrl, token, type }: { roomUrl: string; token: string; type: "AUDIO" | "VIDEO" },
) {
  if (prewarmed.has(key)) return;

  // Dynamic import, not static — same reasoning as DirectCallFrame/CallFrame:
  // this package touches browser globals at module load, which can't happen
  // during a "use client" component's initial server-rendered pass (and this
  // runs from call-button.tsx's event handler, so that's moot here, but the
  // import is shared module-cache-wide — keeping it dynamic here is also
  // what lets DirectCallFrame's own later `import("@daily-co/daily-js")`
  // resolve from cache instantly instead of fetching the chunk twice).
  const promise = import("@daily-co/daily-js").then(({ default: DailyIframe }) => {
    // avoidEval: true — this app's CSP (src/proxy.ts) never allows
    // 'unsafe-eval' in production; without this the call object fails to
    // initialize (same requirement DirectCallFrame/LiveVideoFrame have).
    const call = DailyIframe.createCallObject({ dailyConfig: { avoidEval: true } });
    return call.join({ url: roomUrl, token, startVideoOff: type === "AUDIO" }).then(() => call);
  });

  prewarmed.set(key, { promise });

  // Nobody may ever call takePrewarmedCall for this key (the callee
  // declines, or the caller cancels before accept) — cancelPrewarm already
  // handles tearing the real call object down in that case, but the
  // promise itself still needs a catch here so a join failure never
  // surfaces as an unhandled rejection with no DirectCallFrame around to
  // report it through joinError.
  promise.catch(() => {});
}

/**
 * Removes and returns the in-flight/already-joined call for `key`, if any —
 * DirectCallFrame adopts it instead of creating its own. Ownership transfers
 * to the caller of this function: whoever takes it is now responsible for
 * destroying it (DirectCallFrame's existing cleanup already does, the same
 * as it does for a call object it created itself).
 */
export function takePrewarmedCall(key: string): Promise<DailyCall> | undefined {
  const entry = prewarmed.get(key);
  if (!entry) return undefined;
  prewarmed.delete(key);
  return entry.promise;
}

/**
 * Tears down a prewarmed join nobody ended up adopting — the callee
 * declined, the caller cancelled, the ring timed out before Accept, or
 * call-button.tsx itself unmounted while still ringing.
 */
export function cancelPrewarm(key: string) {
  const entry = prewarmed.get(key);
  if (!entry) return;
  prewarmed.delete(key);
  entry.promise.then((call) => call.destroy()).catch(() => {});
}
