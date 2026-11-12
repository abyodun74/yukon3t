// One Daily REST request with a per-attempt timeout and a bounded retry. Every call that sits on a user's critical
// path (starting a live stream, minting a join token, placing a call) goes through this, so a slow or briefly
// overloaded Daily API (a 429 when many people start streams or join at the same moment, a 5xx, a dropped
// connection) costs a short wait instead of a hung request or an outright failure. Kept free of anything
// server-only (fetch and sleep are injectable) so the retry rules are unit-tested.

/** One attempt is abandoned after this long. Daily normally answers in well under a second. */
export const DAILY_ATTEMPT_TIMEOUT_MS = 5_000;
/** At most this many attempts per request. */
export const DAILY_MAX_ATTEMPTS = 3;
/** No new attempt starts once this much time has passed since the first one began (keeps a request well inside a serverless function's limit). */
export const DAILY_RETRY_BUDGET_MS = 10_000;
/** Backoff before attempt 2 and 3 (plus up to 50% jitter, so callers that failed together don't retry together). */
export const DAILY_BACKOFF_MS = [300, 900] as const;
/** A Retry-After header is honoured up to this long; anything longer is not worth holding a user's request for. */
export const DAILY_MAX_RETRY_AFTER_MS = 2_000;

export class DailyApiError extends Error {
  /** The HTTP status Daily answered with, or null when no answer came back (timeout, network error). */
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "DailyApiError";
    this.status = status;
  }
}

/** Worth another attempt: no answer at all, rate limited, or a server-side error. A 4xx other than 429 is a real refusal. */
export function isRetriableDailyStatus(status: number | null): boolean {
  return status === null || status === 429 || status >= 500;
}

/** Parses a Retry-After header (seconds or an HTTP date) into a wait in ms, capped; null when absent or unreadable. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.min(ms, DAILY_MAX_RETRY_AFTER_MS);
}

type Deps = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Sends the request, retrying a retriable failure (see isRetriableDailyStatus) with backoff until it succeeds,
 * DAILY_MAX_ATTEMPTS is reached or DAILY_RETRY_BUDGET_MS has passed. Resolves with the successful Response; throws
 * DailyApiError carrying the last status otherwise. A non-retriable 4xx is thrown at once.
 */
export async function dailyRequest(url: string, init: RequestInit, deps: Deps = {}): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const startedAt = now();
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= DAILY_MAX_ATTEMPTS; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(DAILY_ATTEMPT_TIMEOUT_MS) });
    } catch {
      res = null;
    }
    if (res?.ok) return res;
    lastStatus = res ? res.status : null;
    if (!isRetriableDailyStatus(lastStatus) || attempt === DAILY_MAX_ATTEMPTS) break;

    const backoff = DAILY_BACKOFF_MS[attempt - 1] ?? DAILY_BACKOFF_MS[DAILY_BACKOFF_MS.length - 1];
    const wait = Math.max(backoff * (1 + random() * 0.5), retryAfterMs(res?.headers.get("retry-after") ?? null) ?? 0);
    if (now() - startedAt + wait >= DAILY_RETRY_BUDGET_MS) break;
    await sleep(wait);
  }
  throw new DailyApiError("daily_request_failed", lastStatus);
}
