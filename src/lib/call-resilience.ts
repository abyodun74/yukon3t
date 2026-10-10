/**
 * The timing and decision rules that keep a 1:1 call alive through a
 * backgrounded app, a locked screen or a brief network drop — what
 * direct-call-frame.tsx, daily.ts and the timeout-missed-calls cron all
 * agree on. Dependency-free on purpose, same as live-stream-signal.ts:
 * imported by server code (room lifetime, sweep cutoff) and client
 * components alike.
 */

/**
 * How long a 1:1 call's Daily room and both meeting tokens live (daily.ts).
 * The room ejects everyone at this point (`eject_at_room_exp`), so it is
 * also the hard cap on a single call's length, and the age past which the
 * timeout-missed-calls cron treats a row still at ACCEPTED as abandoned.
 */
export const CALL_ROOM_LIFETIME_SECONDS = 12 * 60 * 60;

/** How long a side that dropped out of the room keeps retrying join() before it gives up and ends the call. */
export const CALL_RECONNECT_WINDOW_MS = 60_000;

const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 8_000;

/**
 * How long the side still in the room waits for a vanished peer before
 * ending the call itself. Deliberately the reconnect window plus a margin:
 * the peer's own retries have to be allowed to run out (and their endCall
 * to land) first, or the two sides race — one ending the call just as the
 * other gets back in.
 */
export const CALL_PEER_LOSS_GRACE_MS = CALL_RECONNECT_WINDOW_MS + 30_000;

/**
 * An ordinary hang-up reaches the other side as "participant left" a moment
 * before the call row's ENDED status does. The "connection was lost" notice
 * waits this long so it doesn't flash up on every normal hang-up.
 */
export const CALL_PEER_LOSS_NOTICE_DELAY_MS = 2_000;

/** How often the side waiting on a vanished peer re-checks whether the call was actually ended server-side. */
export const CALL_PEER_LOSS_STATUS_POLL_MS = 5_000;

/**
 * Delay before reconnect attempt number `attempt + 1` (`attempt` counts the
 * failures so far, from 0), doubling from 1s up to 8s. Null once waiting
 * that long would run past the reconnect window — time to give up.
 */
export function reconnectDelayMs(attempt: number, elapsedMs: number): number | null {
  const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** Math.max(0, attempt), RECONNECT_MAX_DELAY_MS);
  return elapsedMs + delay >= CALL_RECONNECT_WINDOW_MS ? null : delay;
}

/**
 * daily-js reports a fatal error in two shapes: the "error" event
 * (`{ error: { type } }`) and a rejected join() (either that same event
 * object or the bare `{ type }` error, depending on where it failed).
 * Returns the DailyFatalErrorType string from either, or null.
 */
export function dailyErrorType(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const { type, error } = value as { type?: unknown; error?: unknown };
  if (typeof error === "object" && error !== null) {
    const nested = (error as { type?: unknown }).type;
    if (typeof nested === "string") return nested;
  }
  return typeof type === "string" ? type : null;
}

// Everything in DailyFatalErrorType except "connection-error": the room or
// token is gone, expired or refusing us, and no amount of retrying join()
// changes that.
const TERMINAL_CALL_ERRORS = new Set([
  "ejected",
  "nbf-room",
  "nbf-token",
  "exp-room",
  "exp-token",
  "no-room",
  "meeting-full",
  "end-of-life",
  "not-allowed",
]);

/**
 * What to do when this side falls out of the Daily room without the user
 * having hung up (a hang-up never reaches this — see CallSessionProvider's
 * hangUp). "end": the call is over (the other side ended it, or Daily says
 * the room/token is gone) — tear down, no retry. "reconnect": a network
 * drop, a "connection-error", or a bare "left-meeting" with no reason
 * given — retry join(). An unrecognised error type is retried too; the
 * reconnect window bounds how long that can go on.
 */
export function involuntaryLeaveAction({
  errorType,
  callOver,
}: {
  errorType: string | null;
  /** The call row is already ENDED/MISSED/DECLINED server-side. */
  callOver: boolean;
}): "end" | "reconnect" {
  if (callOver) return "end";
  return errorType !== null && TERMINAL_CALL_ERRORS.has(errorType) ? "end" : "reconnect";
}

/** A room or token reaching its own expiry is the documented end of a call that ran the full lifetime, not a fault. */
export function isExpectedCallExpiry(errorType: string | null) {
  return errorType === "exp-room" || errorType === "exp-token";
}

export function isCallOverStatus(status: string) {
  return status === "ENDED" || status === "MISSED" || status === "DECLINED";
}

/**
 * The other side of a 1:1 call. After they drop and rejoin, Daily keeps
 * their old, dead participant listed until its own server-side timeout, so
 * for a while there are two — the most recently joined one is the live one.
 */
export function latestJoined<T extends { joined_at?: Date }>(participants: T[]): T | undefined {
  let latest: T | undefined;
  for (const p of participants) {
    if (!latest || (p.joined_at?.getTime() ?? 0) >= (latest.joined_at?.getTime() ?? 0)) latest = p;
  }
  return latest;
}

/**
 * The other people in a call, one entry per person. Generalises latestJoined
 * to a call with several remotes: sessions are grouped by `user_id` (set from
 * the meeting token, see daily.ts) so someone who dropped and rejoined counts
 * once, as their most recently joined session. A session with no `user_id`
 * stands for itself. Order is that of each person's first appearance, so a
 * rejoin doesn't reshuffle the tiles.
 */
export function remotesByUser<T extends { joined_at?: Date; user_id?: string; session_id: string }>(
  participants: T[],
): T[] {
  const byUser = new Map<string, T[]>();
  for (const p of participants) {
    const key = p.user_id || p.session_id;
    const sessions = byUser.get(key);
    if (sessions) sessions.push(p);
    else byUser.set(key, [p]);
  }
  return [...byUser.values()].map((sessions) => latestJoined(sessions) as T);
}

/** How long an unanswered ring lasts before the timeout-missed-calls cron marks it MISSED — the call itself, or one person being added to it. */
export const CALL_RING_TIMEOUT_MS = 60_000;

/** The most people one call can hold, counting everyone in it and everyone still being rung. */
export const CALL_MAX_PARTICIPANTS = 8;

/**
 * Whether a call that has had people added to it is over, asked whenever
 * someone leaves, declines or rings out. `joined` and `ringing` count its
 * CallParticipant rows in those states. It ends once nobody is in it, or
 * once one person is left with nobody still being rung — so an invite
 * outlives its inviter hanging up for as long as someone else is still in
 * the call to be joined.
 */
export function shouldEndAfterLeave({ joined, ringing }: { joined: number; ringing: number }) {
  return joined === 0 || (joined < 2 && ringing === 0);
}

/**
 * What the local camera needs on returning to the foreground. iOS stops
 * camera capture for a backgrounded app, and depending on the OS version
 * the track either comes back by itself (it was only muted) or is ended for
 * good. "enable": Daily has it off but the user wants it on. "restart": the
 * track is dead while Daily still believes it's on, where a bare
 * setLocalVideo(true) would be a no-op — off then on again. `mutedIsStale`
 * is for a second look a couple of seconds later: a track still muted by
 * then isn't coming back by itself.
 */
export function cameraRecoveryAction({
  wantVideo,
  trackState,
  trackEnded,
  trackMuted,
  mutedIsStale,
}: {
  wantVideo: boolean;
  /** Daily's own track state for the local camera; undefined when there's no local participant yet. */
  trackState: string | undefined;
  trackEnded: boolean;
  trackMuted: boolean;
  mutedIsStale: boolean;
}): "none" | "enable" | "restart" {
  // "blocked" is a permission/device problem — retrying here won't fix it.
  if (!wantVideo || trackState === undefined || trackState === "blocked") return "none";
  if (trackState === "off") return "enable";
  if (trackEnded || (trackMuted && mutedIsStale)) return "restart";
  return "none";
}

/**
 * Whether to tell the peer our camera is paused. Only ever while hidden
 * with the camera meant to be on, and only when capture has really stopped
 * (or is certain to, on iOS) — a desktop tab in the background keeps
 * sending video, and saying "paused" over a live picture would be wrong.
 */
export function shouldAnnounceCameraPaused({
  hidden,
  wantVideo,
  trackMuted,
  trackEnded,
  platformAlwaysPauses,
}: {
  hidden: boolean;
  wantVideo: boolean;
  trackMuted: boolean;
  trackEnded: boolean;
  platformAlwaysPauses: boolean;
}) {
  return hidden && wantVideo && (platformAlwaysPauses || trackMuted || trackEnded);
}

/**
 * How long a "has this call already ended?" round trip is waited on before
 * carrying on without an answer. It is asked in exactly the situations where
 * the network is least trustworthy, and a request on a dead connection can
 * sit there far longer than the reconnect it's holding up is worth.
 */
export const CALL_STATUS_CHECK_TIMEOUT_MS = 3_500;

/**
 * When the peer disappears, the first status check runs this soon rather
 * than a whole CALL_PEER_LOSS_STATUS_POLL_MS later — inside
 * CALL_PEER_LOSS_NOTICE_DELAY_MS, so an ordinary hang-up is recognised as
 * one before the "connection was lost" notice would show.
 */
export const CALL_PEER_LOSS_FIRST_CHECK_MS = 1_000;

/**
 * `promise`'s value, or null if it rejects or hasn't settled within
 * `timeoutMs` — for a question whose answer is optional and whose caller
 * must not be held up by it. Never rejects.
 */
export function settledWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * Whether a session should hold a screen wake lock. Live streams and Collab
 * (every renderer but "direct") always do. A 1:1 call only while it's a
 * video call: on an audio call the phone is at the user's ear, and a WebView
 * has no proximity sensor to blank the screen with — keeping it lit there
 * means cheek-presses on the controls. `localVideoOn` is the live state of
 * this side's camera (null until there's a local participant to read it
 * from, when the type the call started as stands in), so an audio call
 * upgraded to video picks the lock up and one downgraded drops it.
 */
export function sessionNeedsWakeLock({
  renderer,
  type,
  localVideoOn,
}: {
  renderer: "prebuilt" | "custom" | "direct" | undefined;
  type: "AUDIO" | "VIDEO";
  localVideoOn: boolean | null;
}) {
  if (renderer !== "direct") return true;
  return localVideoOn ?? type === "VIDEO";
}

/** How long a hang-up that couldn't reach the server keeps being retried before it's left to the other side's grace period and the timeout-missed-calls sweep. */
export const END_CALL_RETRY_WINDOW_MS = 3 * 60_000;

/** A single endCall attempt still unanswered after this long counts as failed, so one request hung on a dead connection can't stall the retries behind it. */
export const END_CALL_ATTEMPT_TIMEOUT_MS = 15_000;

const END_CALL_RETRY_BASE_DELAY_MS = 2_000;
const END_CALL_RETRY_MAX_DELAY_MS = 30_000;

/**
 * Delay before the next endCall attempt after `failures` failed ones (from
 * 1), doubling from 2s up to 30s. Null once waiting that long would run past
 * END_CALL_RETRY_WINDOW_MS — time to give up.
 */
export function endCallRetryDelayMs(failures: number, elapsedMs: number): number | null {
  const delay = Math.min(END_CALL_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, failures - 1), END_CALL_RETRY_MAX_DELAY_MS);
  return elapsedMs + delay >= END_CALL_RETRY_WINDOW_MS ? null : delay;
}

/**
 * Runs `attempt` until the server has answered it. Resolving at all is the
 * answer — endCall resolves the same whether it ended the call, found it
 * already over or didn't recognise it, and none of those is worth asking
 * again. A rejection or an attempt that outlives END_CALL_ATTEMPT_TIMEOUT_MS
 * means the request never got through: retried on the endCallRetryDelayMs
 * schedule, and straight away whenever `subscribeOnline` reports the
 * connection back, until that schedule gives up. `subscribeOnline` returns
 * its own unsubscribe; `onSettled` fires once, answered or abandoned.
 */
export function retryUntilAnswered({
  attempt,
  subscribeOnline,
  onSettled,
}: {
  attempt: () => Promise<unknown>;
  subscribeOnline: (retryNow: () => void) => () => void;
  onSettled?: () => void;
}) {
  const startedAt = Date.now();
  let failures = 0;
  let settled = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe = () => {};

  function settle() {
    settled = true;
    if (timer) clearTimeout(timer);
    unsubscribe();
    onSettled?.();
  }

  function run() {
    if (settled || inFlight) return;
    if (timer) clearTimeout(timer);
    timer = null;
    inFlight = true;
    const answered = Promise.resolve()
      .then(attempt)
      .then(() => true);
    void settledWithin(answered, END_CALL_ATTEMPT_TIMEOUT_MS).then((ok) => {
      inFlight = false;
      if (settled) return;
      if (ok) {
        settle();
        return;
      }
      failures += 1;
      const delay = endCallRetryDelayMs(failures, Date.now() - startedAt);
      if (delay === null) {
        settle();
        return;
      }
      timer = setTimeout(run, delay);
    });
  }

  unsubscribe = subscribeOnline(run);
  run();
}
