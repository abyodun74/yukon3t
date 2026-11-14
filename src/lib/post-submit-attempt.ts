// The attempt lifecycle of one post submission (PostComposer), kept free of React and the network so every rule is
// unit-tested: the double-tap lock, the idempotency-key policy, how a failure is classified, and what the person is
// told to do next.
//
// Why this exists (iPhone, 2026-11): a first post attempt that failed left the composer unusable until the app was
// reloaded. The lock (`submittingRef`) was released only when the whole attempt settled, and the attempt could hang
// for ever: createPost and the presign call were Server Actions, and Next.js runs a tab's Server Actions strictly one
// at a time through the router's action queue with no timeout. One request that never settles (a WebKit fetch
// suspended with the app and never failed on resume) blocks every later Server Action in the tab, so every retry
// queued behind it and failed or never finished. Uploads and createPost now go through plain route handlers with
// their own timeouts (upload-client.ts, post-create-client.ts), and this module guarantees that, whatever happens, an
// attempt always settles and the next one can run.

/** Where an attempt failed. `timeout`: the whole attempt ran past its lease; `exception`: something threw. */
export type AttemptStep = "read" | "resize" | "frame" | "presign" | "put" | "upload" | "create" | "timeout" | "exception";

/**
 * `no_post`: certainly nothing was created (the server answered with a refusal, or the failure happened before
 * createPost was sent). `unknown`: createPost may have run (a lost response, a timeout, a 5xx), so a retry of the SAME
 * draft must reuse the same key: createPost answers a key that already has a post with success instead of posting
 * twice.
 */
export type AttemptOutcome = "no_post" | "unknown";

export type AttemptFailure = { step: AttemptStep; code: string; outcome: AttemptOutcome };

export type AttemptPhase = "idle" | "running" | "failed" | "succeeded";

export type AttemptState = {
  phase: AttemptPhase;
  /** How many attempts have started (1-based number of the current/last one). */
  attempt: number;
  /** The clientRequestId of the current/last attempt; null after a success (the next post gets a new one). */
  key: string | null;
  /** draftFingerprint of the current/last attempt's draft. */
  fingerprint: string | null;
  startedAt: number | null;
  leaseMs: number;
  lastFailure: AttemptFailure | null;
};

export const INITIAL_ATTEMPT_STATE: AttemptState = Object.freeze({
  phase: "idle",
  attempt: 0,
  key: null,
  fingerprint: null,
  startedAt: null,
  leaseMs: 0,
  lastFailure: null,
}) as AttemptState;

/** Lease floor: no attempt holds the lock longer than this plus its size allowance (see attemptLeaseMs). */
export const ATTEMPT_LEASE_BASE_MS = 3 * 60_000;
/** A worst-case 100 KB/s for the upload part of the lease. */
const LEASE_BYTES_PER_SECOND = 100_000;
/** Hard ceiling, even for a 2GB video: past this the lock is released and the attempt reported as a timeout. */
export const ATTEMPT_LEASE_MAX_MS = 60 * 60_000;

/** How long one attempt may hold the lock, from the bytes it still has to upload. */
export function attemptLeaseMs(uploadBytes: number): number {
  const bytes = Number.isFinite(uploadBytes) && uploadBytes > 0 ? uploadBytes : 0;
  return Math.min(ATTEMPT_LEASE_MAX_MS, ATTEMPT_LEASE_BASE_MS + Math.ceil((bytes / LEASE_BYTES_PER_SECOND) * 1000));
}

/** The lock: an attempt is running and its lease hasn't run out. */
export function isAttemptLocked(state: AttemptState, now: number): boolean {
  return state.phase === "running" && state.startedAt !== null && now - state.startedAt < state.leaseMs;
}

/** Whether the next attempt of `fingerprint` must reuse the previous key (see AttemptOutcome). */
export function reusesKey(state: AttemptState, fingerprint: string): boolean {
  return (
    state.key !== null &&
    state.fingerprint === fingerprint &&
    (state.phase === "failed" || state.phase === "running") &&
    // "running" here means a lease that ran out without the attempt settling: its outcome is unknown.
    (state.phase === "running" || state.lastFailure?.outcome === "unknown")
  );
}

export type BeginResult =
  | { ok: true; state: AttemptState; attempt: number; key: string; reusedKey: boolean }
  | { ok: false; reason: "locked" };

export function beginAttempt(
  state: AttemptState,
  input: { now: number; fingerprint: string; leaseMs: number; newKey: () => string },
): BeginResult {
  if (isAttemptLocked(state, input.now)) return { ok: false, reason: "locked" };
  const reusedKey = reusesKey(state, input.fingerprint);
  const key = reusedKey && state.key ? state.key : input.newKey();
  const attempt = state.attempt + 1;
  return {
    ok: true,
    attempt,
    key,
    reusedKey,
    state: {
      phase: "running",
      attempt,
      key,
      fingerprint: input.fingerprint,
      startedAt: input.now,
      leaseMs: Math.max(1, input.leaseMs),
      lastFailure: state.lastFailure,
    },
  };
}

export type AttemptSettlement = { ok: true } | { ok: false; failure: AttemptFailure };

/** Settles attempt number `attempt`. A stale settle (a newer attempt already started after a lease ran out) is ignored. */
export function settleAttempt(state: AttemptState, attempt: number, settlement: AttemptSettlement): AttemptState {
  if (attempt !== state.attempt || state.phase !== "running") return state;
  if (settlement.ok) {
    return { ...INITIAL_ATTEMPT_STATE, attempt: state.attempt };
  }
  return { ...state, phase: "failed", startedAt: null, lastFailure: settlement.failure };
}

/**
 * A stable string for "the same draft": text, audience, place, event fields and the identity of every attachment.
 * File identity is name + size + type + lastModified (never the content). Two attempts with the same fingerprint post
 * the same thing, which is what makes reusing a key safe.
 */
export function draftFingerprint(parts: {
  content: string;
  fields?: Record<string, string | null | undefined>;
  files?: ReadonlyArray<{ name: string; size: number; type: string; lastModified?: number } | null | undefined>;
  urls?: ReadonlyArray<string | null | undefined>;
}): string {
  const fields = Object.entries(parts.fields ?? {})
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`);
  const files = (parts.files ?? [])
    .filter((f): f is NonNullable<typeof f> => Boolean(f))
    .map((f) => `${f.name}|${f.size}|${f.type}|${f.lastModified ?? 0}`);
  const urls = (parts.urls ?? []).filter((u): u is string => Boolean(u));
  return JSON.stringify([parts.content, fields, files, urls]);
}

// --- Classifying a createPost answer ------------------------------------------

export type CreateAnswer =
  | { kind: "ok"; held: boolean }
  | { kind: "device"; challengeId: string }
  | { kind: "error"; code: string; outcome: AttemptOutcome; retryable: boolean };

/**
 * What one createPost round trip means. `transport`: "ok" with the HTTP status and parsed JSON (null if unparseable),
 * "timeout" when our own timer aborted it, "network" when fetch rejected.
 *  - a JSON answer from the route: the server's verdict (definitive);
 *  - 404: the route isn't on the server (a newer client against an older deploy) -> stale_deployment, no post;
 *  - 401/403: signed out or refused before createPost ran -> no post;
 *  - 429 without JSON: the page-level limiter in proxy.ts refused it before the route ran -> no post;
 *  - 408/5xx, a non-JSON 2xx, a timeout or a network error: createPost may or may not have run -> unknown, retryable
 *    with the same key.
 */
export function classifyCreateAnswer(
  transport: { kind: "ok"; status: number; json: unknown } | { kind: "timeout" } | { kind: "network" },
): CreateAnswer {
  if (transport.kind === "timeout") return { kind: "error", code: "timeout", outcome: "unknown", retryable: true };
  if (transport.kind === "network") return { kind: "error", code: "network", outcome: "unknown", retryable: true };
  const { status, json } = transport;
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  if (status >= 200 && status <= 299 && body && "error" in body) {
    const error = body.error;
    if (error === null || error === undefined) return { kind: "ok", held: body.held === true };
    if (error === "device_verification_required" && typeof body.challengeId === "string") {
      return { kind: "device", challengeId: body.challengeId };
    }
    return { kind: "error", code: typeof error === "string" ? error : "other", outcome: "no_post", retryable: false };
  }
  if (status === 404) return { kind: "error", code: "stale_deployment", outcome: "no_post", retryable: false };
  if (status === 401 || status === 403) return { kind: "error", code: "unauthorized", outcome: "no_post", retryable: false };
  if (status === 429) return { kind: "error", code: "rate_limited", outcome: "no_post", retryable: false };
  return { kind: "error", code: "server_error", outcome: "unknown", retryable: true };
}

// --- What to tell the person -------------------------------------------------

/**
 * - retry: the same draft can be sent again as it is (Retry button);
 * - repick: the picked file can't be read any more (iOS removed its temporary copy): choose it again;
 * - wait: a limiter refused it; Retry after a moment;
 * - reload: this app version is out of date;
 * - change: the server refused the content itself (moderation, invalid, too large...); retrying as is won't help.
 */
export type RetryAdvice = "retry" | "repick" | "wait" | "reload" | "change";

const CHANGE_CODES = new Set([
  "moderation",
  "invalid",
  "too_large",
  "not_a_member",
  "not_configured",
  "unauthorized",
  "repeat_invalid",
  "repeat_too_short",
  "repeat_too_long",
]);

export function retryAdvice(failure: Pick<AttemptFailure, "code">): RetryAdvice {
  if (failure.code === "file_unreadable") return "repick";
  if (failure.code === "stale_deployment") return "reload";
  if (failure.code === "rate_limited") return "wait";
  if (CHANGE_CODES.has(failure.code)) return "change";
  return "retry";
}

// --- Running an attempt -------------------------------------------------------

export type AttemptBodyResult<T> = { ok: true; value: T } | { ok: false; failure: AttemptFailure };

export type AttemptTicket = { attempt: number; key: string; reusedKey: boolean; leaseMs: number };

export type AttemptRunResult<T> =
  | { status: "ok"; value: T; attempt: number; key: string }
  | { status: "failed"; failure: AttemptFailure; attempt: number; key: string };

/**
 * The composer's handle on the attempt state: begin() is synchronous (so a second tap in the same tick is refused
 * before anything else happens), execute() runs the attempt's body and ALWAYS settles it: on a returned failure, on a
 * throw (step "exception") and when the lease runs out before the body finishes (step "timeout", with the body's
 * signal aborted). The settle happens in a finally, so no path leaves the lock held.
 */
export function createAttemptController(options: {
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
} = {}) {
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let state: AttemptState = INITIAL_ATTEMPT_STATE;

  return {
    getState: () => state,
    isLocked: () => isAttemptLocked(state, now()),
    /** Starts an attempt, or null while one is running (a double tap). */
    begin(input: { fingerprint: string; leaseMs: number; newKey: () => string }): AttemptTicket | null {
      const result = beginAttempt(state, { ...input, now: now() });
      if (!result.ok) return null;
      state = result.state;
      return { attempt: result.attempt, key: result.key, reusedKey: result.reusedKey, leaseMs: result.state.leaseMs };
    },
    async execute<T>(
      ticket: AttemptTicket,
      body: (ctx: { key: string; attempt: number; signal: AbortSignal }) => Promise<AttemptBodyResult<T>>,
    ): Promise<AttemptRunResult<T>> {
      const controller = new AbortController();
      let timer: unknown = null;
      let outcome: AttemptBodyResult<T> = {
        ok: false,
        failure: { step: "exception", code: "exception", outcome: "unknown" },
      };
      try {
        const leaseExpired = new Promise<AttemptBodyResult<T>>((resolve) => {
          timer = setTimer(() => {
            controller.abort();
            resolve({ ok: false, failure: { step: "timeout", code: "timeout", outcome: "unknown" } });
          }, ticket.leaseMs);
        });
        const run = (async () => body({ key: ticket.key, attempt: ticket.attempt, signal: controller.signal }))().catch(
          (): AttemptBodyResult<T> => ({ ok: false, failure: { step: "exception", code: "exception", outcome: "unknown" } }),
        );
        outcome = await Promise.race([run, leaseExpired]);
      } finally {
        if (timer !== null) clearTimer(timer);
        state = settleAttempt(state, ticket.attempt, outcome.ok ? { ok: true } : { ok: false, failure: outcome.failure });
      }
      return outcome.ok
        ? { status: "ok", value: outcome.value, attempt: ticket.attempt, key: ticket.key }
        : { status: "failed", failure: outcome.failure, attempt: ticket.attempt, key: ticket.key };
    },
  };
}

export type AttemptController = ReturnType<typeof createAttemptController>;

/** A fresh clientRequestId (createPost accepts 8-64 of [A-Za-z0-9-]). */
export function newRequestKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
