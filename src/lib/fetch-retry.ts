// Bounded, jittered retries for idempotent reads (GET/HEAD) on flaky
// networks: a dropped packet on weak LTE or a Wi-Fi handoff fails a fetch()
// that a second attempt a moment later would have completed, and a stalled
// connection (bytes stop flowing, nothing errors) otherwise leaves a fetch
// hanging indefinitely. Writes never go through here: a Server Action or a
// POST that timed out on the client may still have run on the server, so
// retrying it blindly could post twice — those keep their own
// clientRequestId / withRetry handling (upload-client.ts, post-composer.tsx).
// Kept free of React and of the network-quality store so it's unit-testable;
// the browser wiring (timeout per network quality, the "retrying" indicator)
// is passed in by fetchWithRetryClient in network-quality-client.ts.

export type BackoffOptions = { baseMs?: number; maxMs?: number; random?: () => number };

/**
 * Exponential backoff with jitter: attempt 1 waits ~baseMs, each next one
 * twice as long, capped at maxMs, each scaled by a random 50-100% so many
 * clients that failed together (a cell tower blip, a deploy) don't all
 * retry in the same instant.
 */
export function backoffDelayMs(attempt: number, { baseMs = 500, maxMs = 8_000, random = Math.random }: BackoffOptions = {}): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp * (0.5 + random() * 0.5));
}

/** 408 / 425 / 429 / 5xx are worth another try; any other status is the server's real answer. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

export class FetchTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = "FetchTimeoutError";
  }
}

export type FetchRetryOptions = {
  /** Total attempts including the first (default 3). Non-GET/HEAD requests always get exactly 1. */
  attempts?: number;
  /** Per-attempt ceiling before it's aborted and counted as failed (default 15s). */
  timeoutMs?: number;
  backoff?: BackoffOptions;
  /** Caller's own signal: aborting it stops everything, no further retries. */
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Resolves once a retry is worth sending (e.g. the device is back online). */
  waitUntilReady?: () => Promise<void>;
  /** Called before each retry (attempt = the retry's number, 2..attempts). */
  onRetry?: (attempt: number, reason: unknown) => void;
  /** Called with how long the attempt took to get response headers (or to time out). */
  onSample?: (ms: number) => void;
  now?: () => number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * fetch() with a per-attempt timeout and, for GET/HEAD only, bounded retries
 * on network errors, timeouts and retryable statuses. Resolves with the last
 * Response (which may still be a non-OK one — callers check `res.ok` as
 * before) or rejects with the last error. Never retries once the caller's
 * own signal has aborted.
 */
export async function fetchWithRetry(input: string, init: RequestInit = {}, options: FetchRetryOptions = {}): Promise<Response> {
  const {
    timeoutMs = 15_000,
    backoff,
    signal,
    fetchImpl = fetch,
    sleep = defaultSleep,
    waitUntilReady,
    onRetry,
    onSample,
    now = Date.now,
  } = options;
  const method = (init.method ?? "GET").toUpperCase();
  const idempotent = method === "GET" || method === "HEAD";
  const attempts = idempotent ? Math.max(1, options.attempts ?? 3) : 1;

  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const forwardAbort = () => controller.abort();
    signal?.addEventListener("abort", forwardAbort, { once: true });
    const startedAt = now();

    let failure: unknown;
    try {
      const res = await fetchImpl(input, { ...init, signal: controller.signal });
      onSample?.(now() - startedAt);
      if (!isRetryableStatus(res.status) || attempt >= attempts) return res;
      // Not read by anyone: release the connection instead of leaving the body pending.
      res.body?.cancel().catch(() => {});
      failure = new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (signal?.aborted) throw err;
      if (timedOut) {
        onSample?.(timeoutMs);
        failure = new FetchTimeoutError(timeoutMs);
      } else {
        failure = err;
      }
      if (attempt >= attempts) throw failure;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forwardAbort);
    }

    onRetry?.(attempt + 1, failure);
    await sleep(backoffDelayMs(attempt, backoff));
    if (waitUntilReady) await waitUntilReady();
  }
}
