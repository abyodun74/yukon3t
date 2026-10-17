"use client";

import type Daily from "@daily-co/daily-js";
import type { DailyCall } from "@daily-co/daily-js";
import { CALL_STATUS_CHECK_TIMEOUT_MS, reconnectDelayMs, settledWithin } from "@/lib/call-resilience";

/**
 * daily-js allows one call instance at a time (strictMode, its default):
 * createCallObject()/createFrame() throw "Duplicate DailyIframe instances
 * are not allowed" while any other one still exists. destroy() is async —
 * it runs leave() first and only deregisters the instance at the very end —
 * so a fire-and-forget destroy() followed straight away by a new call
 * object (a failed prewarm falling back to a cold start, a call accepted
 * right after a live-stream preview unmounts) used to fail outright with
 * "Couldn't join the call". Every destroy() of a Daily instance in this app
 * goes through trackDailyDestroy, and every new one waits on
 * readyForNewDailyInstance first.
 */
type DailyStatic = Pick<typeof Daily, "getCallInstance" | "createCallObject">;

const pendingDestroys = new Set<Promise<void>>();

/** How long readyForNewDailyInstance waits for tracked destroys to finish before going ahead anyway. */
export const DAILY_TEARDOWN_WAIT_MS = 10_000;

/** How many times a 1:1 call's cold start tries createCallObject() before giving up on the call. */
export const CALL_OBJECT_CREATE_ATTEMPTS = 4;

/**
 * Records a Daily instance's pending destroy() so the next call object can
 * wait for it (see readyForNewDailyInstance). Returns a promise that settles
 * when the destroy does and never rejects — a failed destroy is as finished
 * as it will ever be.
 */
export function trackDailyDestroy(destroyed: Promise<unknown>): Promise<void> {
  const tracked: Promise<void> = destroyed.then(
    () => undefined,
    () => undefined,
  );
  pendingDestroys.add(tracked);
  void tracked.then(() => pendingDestroys.delete(tracked));
  return tracked;
}

/**
 * Resolves once a new Daily call object can be created: every tracked
 * destroy() has finished (or DAILY_TEARDOWN_WAIT_MS has passed). With
 * `evictStray`, an instance still registered after that — one whose
 * destroy hung, or one that was never destroyed at all — is destroyed here,
 * itself bounded by CALL_STATUS_CHECK_TIMEOUT_MS. Never rejects.
 */
export async function readyForNewDailyInstance(
  DailyIframe: Pick<DailyStatic, "getCallInstance">,
  { evictStray }: { evictStray: boolean },
) {
  if (pendingDestroys.size > 0) {
    await settledWithin(Promise.all(pendingDestroys), DAILY_TEARDOWN_WAIT_MS);
  }
  if (!evictStray) return;
  const stray = DailyIframe.getCallInstance();
  if (stray) await settledWithin(trackDailyDestroy(stray.destroy()), CALL_STATUS_CHECK_TIMEOUT_MS);
}

/**
 * A new call object for DirectCallFrame's cold start, or null if
 * `isCancelled()` turned true first. The call is what the user just placed
 * or accepted, so anything still holding Daily's one instance slot (a
 * live-stream preview, a previous call whose teardown hung) is evicted.
 * If createCallObject() still throws, it's retried with the reconnect
 * backoff — CALL_OBJECT_CREATE_ATTEMPTS times at most, never past
 * CALL_RECONNECT_WINDOW_MS — and the last error is thrown after that.
 */
export async function createCallObjectWhenReady(
  DailyIframe: DailyStatic,
  isCancelled: () => boolean,
): Promise<DailyCall | null> {
  const startedAt = Date.now();
  for (let attempt = 0; ; attempt += 1) {
    await readyForNewDailyInstance(DailyIframe, { evictStray: true });
    if (isCancelled()) return null;
    try {
      // avoidEval: true — this app's CSP (src/proxy.ts) never allows
      // 'unsafe-eval' in production; without this the call object fails to
      // initialize (same requirement live-video-frame.tsx already has).
      return DailyIframe.createCallObject({ dailyConfig: { avoidEval: true } });
    } catch (err) {
      const delay =
        attempt + 1 < CALL_OBJECT_CREATE_ATTEMPTS ? reconnectDelayMs(attempt, Date.now() - startedAt) : null;
      if (delay === null) throw err;
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (isCancelled()) return null;
    }
  }
}

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
  entry.promise = import("@daily-co/daily-js").then(async ({ default: DailyIframe }) => {
    // A previous call object may still be on its way out. Nothing else is
    // evicted for a prewarm: it's speculative, and must never tear down a
    // call or stream the user is actually in. If something still holds the
    // instance slot, createCallObject() throws, the prewarm fails, and
    // DirectCallFrame's cold start (which does evict) takes over.
    await readyForNewDailyInstance(DailyIframe, { evictStray: false });
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
          // (Tracked either way, so the fallback's readyForNewDailyInstance
          // keeps waiting on it past this bound.)
          if (!entry.cancelled) await settledWithin(trackDailyDestroy(call.destroy()), CALL_STATUS_CHECK_TIMEOUT_MS);
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
    void trackDailyDestroy(entry.call.destroy());
    return;
  }
  // Not created yet (daily-js still loading): prewarmCall sees `cancelled`
  // and never creates it.
}
