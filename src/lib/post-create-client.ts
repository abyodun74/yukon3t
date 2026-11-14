"use client";

import { backoffDelayMs } from "@/lib/fetch-retry";
import { classifyCreateAnswer, type CreateAnswer } from "@/lib/post-submit-attempt";
import { UPLOAD_ROUTE_HEADER } from "@/lib/upload-route-guard";

/**
 * Sends a built post FormData to createPost through POST /api/posts instead of calling the Server Action directly.
 * Server Actions share one queue per tab with no timeout (see post-submit-attempt.ts): one request that never settles
 * blocks every later one, which is how one failed iPhone post used to break every retry until the app was reloaded.
 * This request has its own timeout and abort, and nothing else waits behind it.
 *
 * The FormData carries one clientRequestId for all tries here, so a try whose answer was lost (timeout, network, 5xx)
 * is retried safely: createPost answers a key that already has a post with success. A server refusal (any JSON
 * answer) is final. Never throws.
 */
export const CREATE_POST_TRY_TIMEOUT_MS = 45_000;
export const CREATE_POST_TRIES = 3;

export async function submitCreatePost(
  fd: FormData,
  options: { signal?: AbortSignal; tries?: number; timeoutMs?: number; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): Promise<CreateAnswer> {
  const tries = options.tries ?? CREATE_POST_TRIES;
  const timeoutMs = options.timeoutMs ?? CREATE_POST_TRY_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let answer: CreateAnswer = { kind: "error", code: "network", outcome: "unknown", retryable: true };

  for (let attempt = 1; attempt <= tries; attempt++) {
    if (options.signal?.aborted) break;
    answer = classifyCreateAnswer(await sendOnce(fd, fetchImpl, timeoutMs, options.signal));
    if (answer.kind !== "error" || !answer.retryable || attempt >= tries) return answer;
    await sleep(backoffDelayMs(attempt, { baseMs: 1000 }));
  }
  return answer;
}

async function sendOnce(
  fd: FormData,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<{ kind: "ok"; status: number; json: unknown } | { kind: "timeout" } | { kind: "network" }> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  signal?.addEventListener("abort", forwardAbort, { once: true });
  try {
    const res = await fetchImpl("/api/posts", {
      method: "POST",
      body: fd,
      credentials: "same-origin",
      cache: "no-store",
      headers: { [UPLOAD_ROUTE_HEADER]: "1" },
      signal: controller.signal,
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { kind: "ok", status: res.status, json };
  } catch {
    return timedOut ? { kind: "timeout" } : { kind: "network" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}
