"use client";

import type { DailyCall } from "@daily-co/daily-js";
import { CALL_STATUS_CHECK_TIMEOUT_MS, settledWithin } from "@/lib/call-resilience";

/**
 * Lets either side of a 1:1 call join the Daily room early — the caller the
 * moment it starts ringing, the callee the moment their own device starts
 * ringing — instead of only starting to connect once the callee actually
 * taps Accept (what both sides used to do — see DirectCallFrame). By the
 * time Accept happens, whoever's side this ran for is often already sitting
 * connected in the room — DirectCallFrame then adopts this object (see
 * takePrewarmedCall) instead of creating and joining its own from scratch,
 * skipping the daily-js-fetch + WebRTC-handshake cost entirely.
 *
 * The callee's case needs one more thing the caller's doesn't: consent.
 * Placing a call is itself consent to join, so the caller's prewarm starts
 * fully live (camera/mic on, same as before this `muted` option existed).
 * The callee hasn't agreed to anything yet during their own ring — `muted:
 * true` joins with BOTH local audio and video off, which (confirmed via
 * daily-js: "settings related to device and media pipeline startup go live
 * when devices are first initialized — either in startCamera(), or in
 * join()") means neither track is ever requested at all: no getUserMedia
 * call, no permission prompt, nothing captured or sent. Only the WebRTC
 * transport (signaling join, ICE, DTLS) comes up early; DirectCallFrame
 * does the actual unmute — the real "Accept" moment — once adopted.
 *
 * Keyed by the same `call:${callId}` string call-session.tsx already uses
 * as its own session dedupe key, not a separate identifier — see
 * call-button.tsx/incoming-call-listener.tsx.
 */
// `call` is set as soon as the call object exists, before its join has finished, so cancelPrewarm can destroy it
// straight away; `cancelled` is how a call object created after the cancel finds out it isn't wanted.
type PrewarmEntry = { promise: Promise<DailyCall>; call: DailyCall | null; cancelled: boolean };

const prewarmed = new Map<string, PrewarmEntry>();

export function prewarmCall(
  key: string,
  { roomUrl, token, type, muted = false }: { roomUrl: string; token: string; type: "AUDIO" | "VIDEO"; muted?: boolean },
) {
  if (prewarmed.has(key)) return;

  // Dynamic import, not static — same reasoning as DirectCallFrame/CallFrame:
  // this package touches browser globals at module load, which can't happen
  // during a "use client" component's initial server-rendered pass (and this
  // runs from call-button.tsx's/incoming-call-listener.tsx's event handler
  // or effect, so that's moot here, but the import is shared module-cache-
  // wide — keeping it dynamic here is also what lets DirectCallFrame's own
  // later `import("@daily-co/daily-js")` resolve from cache instantly
  // instead of fetching the chunk twice).
  // `promise` is assigned straight below: the chain it starts needs `entry` itself.
  const entry = { call: null, cancelled: false } as Omit<PrewarmEntry, "promise"> as PrewarmEntry;
  entry.promise = import("@daily-co/daily-js").then(({ default: DailyIframe }) => {
    // Cancelled while the chunk was still loading: never create the call
    // object at all, so no camera or microphone is ever requested for it.
    if (entry.cancelled) throw new Error("prewarm_cancelled");
    // avoidEval: true — this app's CSP (src/proxy.ts) never allows
    // 'unsafe-eval' in production; without this the call object fails to
    // initialize (same requirement DirectCallFrame/LiveVideoFrame have).
    const call = DailyIframe.createCallObject({ dailyConfig: { avoidEval: true } });
    entry.call = call;
    return call
      .join({ url: roomUrl, token, startVideoOff: muted || type === "AUDIO", startAudioOff: muted })
      .then(
        () => call,
        async (err: unknown) => {
          // Nobody ever gets hold of a call object whose join failed — the
          // promise rejects, so neither takePrewarmedCall's caller nor
          // cancelPrewarm has anything to destroy — and daily-js refuses to
          // create another while this one exists. Destroyed here, and
          // waited on (it only deregisters at the very end of destroy())
          // before rejecting, so whoever falls back to a fresh call object
          // can create one straight away. The wait is bounded so a destroy
          // that hangs can't hold the fallback up indefinitely. Skipped when
          // cancelPrewarm already destroyed it (that is what failed the join).
          if (!entry.cancelled) await settledWithin(call.destroy(), CALL_STATUS_CHECK_TIMEOUT_MS);
          throw err;
        },
      );
  });

  prewarmed.set(key, entry);
  const { promise } = entry;

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
  entry.cancelled = true;
  // Destroyed now, not once its join settles: a join still in flight (a slow
  // or dropped network while the phone rang) would otherwise keep the
  // caller's camera and microphone live for a call that is already over,
  // for as long as that join takes, and daily-js refuses to create the next
  // call's object until this one is gone. Destroying it fails the pending
  // join, which prewarmCall's own rejection path then leaves alone.
  if (entry.call) {
    entry.call.destroy().catch(() => {});
    return;
  }
  // Not created yet (daily-js still loading): prewarmCall sees `cancelled`
  // and never creates it.
}
