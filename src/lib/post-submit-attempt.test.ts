import { describe, expect, it, vi } from "vitest";
import {
  ATTEMPT_LEASE_BASE_MS,
  ATTEMPT_LEASE_MAX_MS,
  INITIAL_ATTEMPT_STATE,
  attemptLeaseMs,
  beginAttempt,
  classifyCreateAnswer,
  createAttemptController,
  draftFingerprint,
  isAttemptLocked,
  newRequestKey,
  retryAdvice,
  reusesKey,
  settleAttempt,
  type AttemptBodyResult,
  type AttemptFailure,
  type AttemptState,
} from "@/lib/post-submit-attempt";
import { submitCreatePost } from "@/lib/post-create-client";
import { putAttemptOutcome } from "@/lib/write-once-upload";

let keyCounter = 0;
const nextKey = () => `key-${++keyCounter}-xxxxxxxx`;

function begun(state: AttemptState, fingerprint = "fp", now = 0, leaseMs = 1000) {
  const r = beginAttempt(state, { now, fingerprint, leaseMs, newKey: nextKey });
  if (!r.ok) throw new Error("locked");
  return r;
}

const noPost = (step: AttemptFailure["step"], code: string): AttemptFailure => ({ step, code, outcome: "no_post" });
const unknown = (step: AttemptFailure["step"], code: string): AttemptFailure => ({ step, code, outcome: "unknown" });

describe("attempt lock", () => {
  it("is free initially", () => {
    expect(isAttemptLocked(INITIAL_ATTEMPT_STATE, 0)).toBe(false);
  });

  it("refuses a second begin while one is running (double tap)", () => {
    const first = begun(INITIAL_ATTEMPT_STATE);
    expect(beginAttempt(first.state, { now: 10, fingerprint: "fp", leaseMs: 1000, newKey: nextKey })).toEqual({
      ok: false,
      reason: "locked",
    });
  });

  it("is released by a failure, by a success, and by the lease running out", () => {
    const a = begun(INITIAL_ATTEMPT_STATE);
    expect(isAttemptLocked(settleAttempt(a.state, a.attempt, { ok: false, failure: noPost("put", "network") }), 1)).toBe(false);
    expect(isAttemptLocked(settleAttempt(a.state, a.attempt, { ok: true }), 1)).toBe(false);
    expect(isAttemptLocked(a.state, 999)).toBe(true);
    expect(isAttemptLocked(a.state, 1000)).toBe(false);
  });

  it("ignores a stale settle from an attempt that was superseded after its lease ran out", () => {
    const a = begun(INITIAL_ATTEMPT_STATE, "fp", 0, 100);
    const b = begun(a.state, "fp", 500, 100); // lease of a expired
    const afterStale = settleAttempt(b.state, a.attempt, { ok: true });
    expect(afterStale).toBe(b.state);
    expect(isAttemptLocked(afterStale, 550)).toBe(true);
  });

  it("lease grows with the upload size, within bounds", () => {
    expect(attemptLeaseMs(0)).toBe(ATTEMPT_LEASE_BASE_MS);
    expect(attemptLeaseMs(Number.NaN)).toBe(ATTEMPT_LEASE_BASE_MS);
    expect(attemptLeaseMs(10_000_000)).toBe(ATTEMPT_LEASE_BASE_MS + 100_000);
    expect(attemptLeaseMs(50 * 1024 ** 3)).toBe(ATTEMPT_LEASE_MAX_MS);
  });
});

describe("idempotency key policy", () => {
  it("mints a new key for the first attempt", () => {
    const a = begun(INITIAL_ATTEMPT_STATE);
    expect(a.reusedKey).toBe(false);
    expect(a.key).toMatch(/^key-/);
  });

  it("mints a new key after a failure that certainly created nothing", () => {
    for (const failure of [noPost("presign", "network"), noPost("put", "upload_failed"), noPost("create", "moderation"), noPost("read", "file_unreadable")]) {
      const a = begun(INITIAL_ATTEMPT_STATE);
      const failed = settleAttempt(a.state, a.attempt, { ok: false, failure });
      const b = begun(failed);
      expect(b.reusedKey).toBe(false);
      expect(b.key).not.toBe(a.key);
    }
  });

  it("reuses the key only for the same draft after an unknown outcome", () => {
    const a = begun(INITIAL_ATTEMPT_STATE, "draft-1");
    const failed = settleAttempt(a.state, a.attempt, { ok: false, failure: unknown("create", "timeout") });
    expect(reusesKey(failed, "draft-1")).toBe(true);
    const same = begun(failed, "draft-1");
    expect(same.reusedKey).toBe(true);
    expect(same.key).toBe(a.key);
    const edited = begun(failed, "draft-2");
    expect(edited.reusedKey).toBe(false);
    expect(edited.key).not.toBe(a.key);
  });

  it("mints a new key after a success (the next post is a new post)", () => {
    const a = begun(INITIAL_ATTEMPT_STATE, "draft-1");
    const ok = settleAttempt(a.state, a.attempt, { ok: true });
    expect(ok.key).toBeNull();
    const b = begun(ok, "draft-1");
    expect(b.reusedKey).toBe(false);
    expect(b.key).not.toBe(a.key);
  });

  it("keeps reusing the same key across several unknown outcomes of the same draft", () => {
    let state = INITIAL_ATTEMPT_STATE;
    const keys: string[] = [];
    for (let i = 0; i < 3; i++) {
      const a = begun(state, "d");
      keys.push(a.key);
      state = settleAttempt(a.state, a.attempt, { ok: false, failure: unknown("create", "server_error") });
    }
    expect(new Set(keys).size).toBe(1);
  });

  it("newRequestKey fits createPost's clientRequestId pattern", () => {
    expect(newRequestKey()).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });
});

describe("draftFingerprint", () => {
  const file = { name: "a.jpg", size: 10, type: "image/jpeg", lastModified: 1 };
  it("is stable for the same draft and ignores empty fields and field order", () => {
    expect(draftFingerprint({ content: "hi", fields: { a: "1", b: null, c: "" }, files: [file] })).toBe(
      draftFingerprint({ content: "hi", fields: { a: "1" }, files: [file, null] }),
    );
    expect(draftFingerprint({ content: "x", fields: { b: "2", a: "1" } })).toBe(draftFingerprint({ content: "x", fields: { a: "1", b: "2" } }));
  });
  it("changes when the text, a field, a file or a link changes", () => {
    const base = draftFingerprint({ content: "hi", fields: { visibility: "PUBLIC" }, files: [file], urls: ["u"] });
    expect(draftFingerprint({ content: "hi!", fields: { visibility: "PUBLIC" }, files: [file], urls: ["u"] })).not.toBe(base);
    expect(draftFingerprint({ content: "hi", fields: { visibility: "PRIVATE" }, files: [file], urls: ["u"] })).not.toBe(base);
    expect(draftFingerprint({ content: "hi", fields: { visibility: "PUBLIC" }, files: [{ ...file, size: 11 }], urls: ["u"] })).not.toBe(base);
    expect(draftFingerprint({ content: "hi", fields: { visibility: "PUBLIC" }, files: [file], urls: ["v"] })).not.toBe(base);
  });
});

describe("classifyCreateAnswer", () => {
  it("success, held and the device step-up", () => {
    expect(classifyCreateAnswer({ kind: "ok", status: 200, json: { error: null } })).toEqual({ kind: "ok", held: false });
    expect(classifyCreateAnswer({ kind: "ok", status: 200, json: { error: null, held: true } })).toEqual({ kind: "ok", held: true });
    expect(
      classifyCreateAnswer({ kind: "ok", status: 200, json: { error: "device_verification_required", challengeId: "c1" } }),
    ).toEqual({ kind: "device", challengeId: "c1" });
  });
  it("a JSON refusal is final and created nothing", () => {
    for (const code of ["moderation", "rate_limited", "invalid", "upload_check_failed", "device_verification_required"]) {
      expect(classifyCreateAnswer({ kind: "ok", status: 200, json: { error: code } })).toEqual({
        kind: "error",
        code,
        outcome: "no_post",
        retryable: false,
      });
    }
  });
  it("transport failures and 5xx are unknown and retryable", () => {
    expect(classifyCreateAnswer({ kind: "timeout" })).toMatchObject({ code: "timeout", outcome: "unknown", retryable: true });
    expect(classifyCreateAnswer({ kind: "network" })).toMatchObject({ code: "network", outcome: "unknown", retryable: true });
    for (const status of [500, 502, 503, 504, 408]) {
      expect(classifyCreateAnswer({ kind: "ok", status, json: null })).toMatchObject({ code: "server_error", outcome: "unknown" });
    }
    expect(classifyCreateAnswer({ kind: "ok", status: 200, json: null })).toMatchObject({ outcome: "unknown", retryable: true });
  });
  it("refusals before createPost ran created nothing", () => {
    expect(classifyCreateAnswer({ kind: "ok", status: 404, json: null })).toMatchObject({ code: "stale_deployment", outcome: "no_post" });
    expect(classifyCreateAnswer({ kind: "ok", status: 401, json: { error: "unauthorized" } })).toMatchObject({
      code: "unauthorized",
      outcome: "no_post",
    });
    expect(classifyCreateAnswer({ kind: "ok", status: 403, json: null })).toMatchObject({ code: "unauthorized" });
    expect(classifyCreateAnswer({ kind: "ok", status: 429, json: null })).toMatchObject({ code: "rate_limited", outcome: "no_post" });
  });
});

describe("retryAdvice", () => {
  it("maps every failure to what the person can do", () => {
    expect(retryAdvice({ code: "file_unreadable" })).toBe("repick");
    expect(retryAdvice({ code: "stale_deployment" })).toBe("reload");
    expect(retryAdvice({ code: "rate_limited" })).toBe("wait");
    for (const code of ["moderation", "invalid", "too_large", "not_a_member", "not_configured", "unauthorized"]) {
      expect(retryAdvice({ code })).toBe("change");
    }
    for (const code of ["network", "timeout", "server_error", "upload_failed", "exception", "upload_check_failed", "other"]) {
      expect(retryAdvice({ code })).toBe("retry");
    }
  });
});

describe("createAttemptController", () => {
  it("begin is synchronous and refuses a double tap", () => {
    const c = createAttemptController();
    const t1 = c.begin({ fingerprint: "a", leaseMs: 10_000, newKey: nextKey });
    expect(t1).not.toBeNull();
    expect(c.begin({ fingerprint: "a", leaseMs: 10_000, newKey: nextKey })).toBeNull();
    expect(c.isLocked()).toBe(true);
  });

  it("settles on a thrown exception and unlocks", async () => {
    const c = createAttemptController();
    const t = c.begin({ fingerprint: "a", leaseMs: 10_000, newKey: nextKey })!;
    const r = await c.execute(t, async () => {
      throw new Error("boom");
    });
    expect(r).toMatchObject({ status: "failed", failure: { step: "exception", outcome: "unknown" } });
    expect(c.isLocked()).toBe(false);
  });

  it("a body that never settles is cut off by the lease, its signal aborted, and the lock released", async () => {
    let fire: (() => void) | null = null;
    const c = createAttemptController({ setTimer: (fn) => ((fire = fn), 1), clearTimer: () => {} });
    const t = c.begin({ fingerprint: "a", leaseMs: 50, newKey: nextKey })!;
    let seenSignal: AbortSignal | null = null;
    const pending = c.execute(t, ({ signal }) => {
      seenSignal = signal;
      return new Promise<AttemptBodyResult<string>>(() => {});
    });
    expect(c.isLocked()).toBe(true);
    fire!();
    const r = await pending;
    expect(r).toMatchObject({ status: "failed", failure: { step: "timeout", code: "timeout", outcome: "unknown" } });
    expect(seenSignal!.aborted).toBe(true);
    expect(c.isLocked()).toBe(false);
  });

  it("clears its lease timer on every path", async () => {
    const clearTimer = vi.fn();
    const c = createAttemptController({ setTimer: () => "handle", clearTimer });
    const t1 = c.begin({ fingerprint: "a", leaseMs: 50, newKey: nextKey })!;
    await c.execute(t1, async () => ({ ok: true, value: 1 }));
    const t2 = c.begin({ fingerprint: "a", leaseMs: 50, newKey: nextKey })!;
    await c.execute(t2, async () => ({ ok: false, failure: noPost("put", "network") }));
    const t3 = c.begin({ fingerprint: "a", leaseMs: 50, newKey: nextKey })!;
    await c.execute(t3, async () => {
      throw new Error("x");
    });
    expect(clearTimer).toHaveBeenCalledTimes(3);
    expect(clearTimer).toHaveBeenCalledWith("handle");
  });
});

// --- Simulation: attempt 1 fails at every step; attempts 2 and 3 must run and succeed ------------------------------

/** A fake R2 + createPost: write-once objects (a second PUT of a key is 412) and posts deduplicated on clientRequestId. */
class FakeBackend {
  objects = new Set<string>();
  posts = new Map<string, string>(); // clientRequestId -> object key
  private nextObject = 0;
  presignedKeys: string[] = [];
  presign(): string {
    const key = `post-image/u1/${++this.nextObject}.webp`;
    this.presignedKeys.push(key);
    return key;
  }
  put(key: string): number {
    if (this.objects.has(key)) return 412;
    this.objects.add(key);
    return 200;
  }
  createPost(clientRequestId: string, objectKey: string): { error: string | null } {
    if (this.posts.has(clientRequestId)) return { error: null };
    if (!this.objects.has(objectKey)) return { error: "upload_check_failed" };
    this.posts.set(clientRequestId, objectKey);
    return { error: null };
  }
}

type FailAt =
  | "resize"
  | "frame"
  | "presign"
  | "put_network"
  | "put_412"
  | "create_error"
  | "create_lost_response"
  | "create_timeout"
  | "create_refused"
  | "attempt_timeout"
  | "exception"
  | null;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Mirrors PostComposer's attempt body: upload (resize, frame, presign, PUT) then createPost through the route client. */
function makeBody(backend: FakeBackend, failAt: FailAt) {
  return async ({ key, signal }: { key: string; signal: AbortSignal }): Promise<AttemptBodyResult<string>> => {
    if (failAt === "exception") throw new Error("unexpected");
    if (failAt === "attempt_timeout") return new Promise(() => {});
    if (failAt === "resize") return { ok: false, failure: noPost("resize", "imageProcess") };
    if (failAt === "frame") return { ok: false, failure: noPost("frame", "frame_failed") };
    if (failAt === "presign") return { ok: false, failure: noPost("presign", "network") };
    const objectKey = backend.presign();
    if (failAt === "put_network") return { ok: false, failure: noPost("put", "network") };
    if (failAt === "put_412") backend.objects.add(objectKey); // the key was already written, not by this upload
    const outcome = putAttemptOutcome(backend.put(objectKey), 1);
    if (outcome !== "ok") return { ok: false, failure: noPost("put", "upload_failed") };

    const fd = new FormData();
    fd.set("clientRequestId", key);
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const sent = init?.body as FormData;
      const id = String(sent.get("clientRequestId"));
      if (failAt === "create_error") return json(500, { error: "server_error" });
      if (failAt === "create_refused") return json(200, { error: "moderation" });
      if (failAt === "create_lost_response") {
        backend.createPost(id, objectKey);
        return json(502, null);
      }
      if (failAt === "create_timeout") {
        backend.createPost(id, objectKey);
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }
      return json(200, backend.createPost(id, objectKey));
    }) as typeof fetch;
    // One try per attempt here, so the failure surfaces as the attempt's (the real client tries up to 3 times).
    const answer = await submitCreatePost(fd, { signal, fetchImpl, tries: 1, timeoutMs: 20, sleep: async () => {} });
    if (answer.kind === "ok") return { ok: true, value: "posted" };
    if (answer.kind === "device") return { ok: true, value: "device" };
    return { ok: false, failure: { step: "create", code: answer.code, outcome: answer.outcome } };
  };
}

const ALL_FAILURES: Exclude<FailAt, null>[] = [
  "resize",
  "frame",
  "presign",
  "put_network",
  "put_412",
  "create_error",
  "create_lost_response",
  "create_timeout",
  "create_refused",
  "attempt_timeout",
  "exception",
];

describe("simulation: a failed first attempt never blocks the next ones", () => {
  for (const failAt of ALL_FAILURES) {
    it(`attempt 1 fails at ${failAt}; attempt 2 (same draft) and attempt 3 (a new post) succeed`, async () => {
      const backend = new FakeBackend();
      let fireLease: (() => void) | null = null;
      const controller = createAttemptController(
        failAt === "attempt_timeout" ? { setTimer: (fn) => ((fireLease = fn), 1), clearTimer: () => {} } : {},
      );

      // Attempt 1
      const t1 = controller.begin({ fingerprint: "draft-A", leaseMs: 60_000, newKey: nextKey })!;
      expect(t1).not.toBeNull();
      const run1 = controller.execute(t1, makeBody(backend, failAt));
      if (failAt === "attempt_timeout") fireLease!();
      const r1 = await run1;
      expect(r1.status).toBe("failed");
      expect(controller.isLocked()).toBe(false);

      // Attempt 2: the same draft, everything working.
      const t2 = controller.begin({ fingerprint: "draft-A", leaseMs: 60_000, newKey: nextKey });
      expect(t2).not.toBeNull();
      const unknownOutcome = r1.status === "failed" && r1.failure.outcome === "unknown";
      // Same key only when attempt 1 may have created the post; otherwise a fresh one.
      expect(t2!.key === t1.key).toBe(unknownOutcome);
      const r2 = await createAttemptControllerRun(controller, t2!, makeBody(backend, null));
      expect(r2.status).toBe("ok");
      expect(controller.isLocked()).toBe(false);

      // Exactly one post for draft A, even when attempt 1 stored it and only its answer was lost.
      expect(backend.posts.size).toBe(1);

      // Attempt 3: a new post, its own key, also succeeds.
      const t3 = controller.begin({ fingerprint: "draft-B", leaseMs: 60_000, newKey: nextKey })!;
      expect(t3.key).not.toBe(t2!.key);
      const r3 = await controller.execute(t3, makeBody(backend, null));
      expect(r3.status).toBe("ok");
      expect(backend.posts.size).toBe(2);

      // Write-once: every upload used its own freshly presigned key; no key was ever PUT twice on purpose.
      expect(new Set(backend.presignedKeys).size).toBe(backend.presignedKeys.length);
    });
  }

  it("attempts 1 and 2 both fail (different steps), attempt 3 still succeeds", async () => {
    const backend = new FakeBackend();
    const controller = createAttemptController();
    for (const failAt of ["put_network", "create_error"] as const) {
      const t = controller.begin({ fingerprint: "draft-A", leaseMs: 60_000, newKey: nextKey })!;
      expect(t).not.toBeNull();
      expect((await controller.execute(t, makeBody(backend, failAt))).status).toBe("failed");
    }
    const t3 = controller.begin({ fingerprint: "draft-A", leaseMs: 60_000, newKey: nextKey })!;
    expect((await controller.execute(t3, makeBody(backend, null))).status).toBe("ok");
    expect(backend.posts.size).toBe(1);
  });

  it("a draft edited after an unknown outcome gets a new key (it is a different post)", async () => {
    const backend = new FakeBackend();
    const controller = createAttemptController();
    const t1 = controller.begin({ fingerprint: "draft-A", leaseMs: 60_000, newKey: nextKey })!;
    await controller.execute(t1, makeBody(backend, "create_lost_response"));
    const t2 = controller.begin({ fingerprint: "draft-A-edited", leaseMs: 60_000, newKey: nextKey })!;
    expect(t2.key).not.toBe(t1.key);
    await controller.execute(t2, makeBody(backend, null));
    expect(backend.posts.size).toBe(2);
  });
});

function createAttemptControllerRun(
  controller: ReturnType<typeof createAttemptController>,
  ticket: NonNullable<ReturnType<ReturnType<typeof createAttemptController>["begin"]>>,
  body: ReturnType<typeof makeBody>,
) {
  return controller.execute(ticket, body);
}
