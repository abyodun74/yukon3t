import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildVlmRequestBody,
  hiveFailureForStatus,
  HIVE_VLM_ENDPOINT,
  HIVE_VLM_MODEL,
  isProviderWideFailure,
  moderateVideo,
  parseRetryAfterSeconds,
  VLM_CATEGORIES,
  VLM_MAX_FPS,
  VLM_MAX_FRAMES,
  VLM_MAX_INPUT_TOKENS,
  VLM_POLICY_PROMPT,
  VLM_REASON_MAX_CHARS,
  VLM_UNKNOWN_DURATION_FPS,
  VLM_VERDICT_SCHEMA,
  vlmFrameEstimate,
  vlmSamplingFps,
  vlmVerdictFromContent,
  vlmVerdictFromResponse,
} from "@/lib/hive";

const CLEAN = {
  sexual_explicit: false,
  minor_sexualized: false,
  violence: false,
  hate: false,
  unsure: false,
  reason: "clean",
};

function completion(content: unknown, finishReason: unknown = "stop") {
  return {
    choices: [{ finish_reason: finishReason, message: { role: "assistant", content } }],
    usage: { prompt_tokens: 4273, completion_tokens: 89 },
  };
}

describe("sampling rate (fps rule)", () => {
  it("is min(0.5, 30 / duration)", () => {
    expect(vlmSamplingFps(10)).toBe(0.5);
    expect(vlmSamplingFps(60)).toBe(0.5);
    expect(vlmSamplingFps(90)).toBe(0.3333);
    expect(vlmSamplingFps(120)).toBe(0.25);
    expect(vlmSamplingFps(180)).toBe(0.1666);
  });

  it("assumes 0.25 fps when the duration is unknown", () => {
    for (const d of [null, undefined, 0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(vlmSamplingFps(d), String(d)).toBe(VLM_UNKNOWN_DURATION_FPS);
    }
  });

  it("never samples more than the frame cap for any known duration up to Hive's 180s", () => {
    for (let d = 1; d <= 180; d += 0.5) {
      expect(d * vlmSamplingFps(d), String(d)).toBeLessThanOrEqual(VLM_MAX_FRAMES);
      expect(vlmSamplingFps(d)).toBeLessThanOrEqual(VLM_MAX_FPS);
      expect(vlmFrameEstimate(d)!).toBeLessThanOrEqual(VLM_MAX_FRAMES);
    }
    expect(vlmFrameEstimate(60)).toBe(30);
    expect(vlmFrameEstimate(null)).toBeNull();
  });

  it("keeps the largest call at the input size verified live (30 frames, ~23,750 tokens)", () => {
    expect(VLM_MAX_INPUT_TOKENS).toBeLessThanOrEqual(24_000);
  });
});

describe("request shape", () => {
  it("asks the VLM once for the whole video, at the fps rule, with the strict schema", () => {
    const body = buildVlmRequestBody("https://media.example.com/v.mp4", 42);
    expect(body.model).toBe(HIVE_VLM_MODEL);
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBeGreaterThanOrEqual(150);
    expect(body.messages).toHaveLength(1);
    const [media, text] = body.messages[0].content;
    expect(media).toEqual({
      type: "media_url",
      media_url: {
        url: "https://media.example.com/v.mp4",
        sampling: { strategy: "fps", fps: 0.5 },
        prompt_scope: "once",
      },
    });
    expect(text).toEqual({ type: "text", text: VLM_POLICY_PROMPT });
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "video_moderation", strict: true, schema: VLM_VERDICT_SCHEMA },
    });
  });

  it("schema: every category plus unsure as required booleans, a required reason, nothing else", () => {
    expect(VLM_VERDICT_SCHEMA.additionalProperties).toBe(false);
    expect([...VLM_VERDICT_SCHEMA.required].sort()).toEqual([...VLM_CATEGORIES, "unsure", "reason"].sort());
    for (const key of [...VLM_CATEGORIES, "unsure"]) {
      expect(VLM_VERDICT_SCHEMA.properties[key as keyof typeof VLM_VERDICT_SCHEMA.properties]).toEqual({ type: "boolean" });
    }
    expect(VLM_VERDICT_SCHEMA.properties.reason).toEqual({ type: "string" });
  });

  it("covers exactly the four kept categories (owner decision 2026-11-22)", () => {
    expect([...VLM_CATEGORIES]).toEqual(["sexual_explicit", "minor_sexualized", "violence", "hate"]);
    for (const gone of ["sexual_nudity", "violence_gore", "hate_symbols", "self_harm"]) {
      expect(Object.keys(VLM_VERDICT_SCHEMA.properties)).not.toContain(gone);
      expect(VLM_POLICY_PROMPT).not.toContain(gone);
    }
  });

  it("the prompt names every category and keeps the minor rule strict", () => {
    for (const key of [...VLM_CATEGORIES, "unsure", "reason"]) expect(VLM_POLICY_PROMPT).toContain(key);
    expect(VLM_POLICY_PROMPT).toMatch(/under 18/);
    expect(VLM_POLICY_PROMPT).toMatch(/If a person's age is unclear and the context is sexual or suggestive, set this to true/);
  });

  it("explicit sexual content only: swimwear, shirtless, artistic or non-explicit content is clean", () => {
    expect(VLM_POLICY_PROMPT).toMatch(/explicit sexual content or pornography/);
    expect(VLM_POLICY_PROMPT).toMatch(/Swimwear, underwear, shirtless people/);
    expect(VLM_POLICY_PROMPT).toMatch(/artistic or other non-explicit nudity are NOT this category/);
    expect(VLM_POLICY_PROMPT).not.toMatch(/suggestive posing/);
    expect(VLM_POLICY_PROMPT).not.toMatch(/self-harm|suicide/);
  });

  it("violence includes promotion of violence and explicit threats against people", () => {
    expect(VLM_POLICY_PROMPT).toMatch(/promotes or glorifies violence, including explicit threats of violence against people/);
  });

  it("hate protects people, sexual orientation and gender identity included, and never targets them", () => {
    expect(VLM_POLICY_PROMPT).toMatch(/attacks, dehumanizes or calls for harm against people because of a protected characteristic/);
    expect(VLM_POLICY_PROMPT).toMatch(/sexual orientation or gender identity/);
    expect(VLM_POLICY_PROMPT).toMatch(/a same-sex couple, a pride flag, religious dress\) is never hate/);
    expect(VLM_POLICY_PROMPT).toMatch(/hate symbols and extremist imagery/);
  });

  it("unsure only for a plausible kept category; an ordinary dark or blurry video is clean", () => {
    expect(VLM_POLICY_PROMPT).toMatch(/Set unsure to true only when a frame plausibly shows one of the four categories/);
    expect(VLM_POLICY_PROMPT).toMatch(/dark, blurry or low quality with no sign of any category is clean, not unsure/);
    expect(VLM_POLICY_PROMPT).not.toMatch(/When in doubt/);
  });

  it("sends the unknown-duration rate when the row has no duration", () => {
    const body = buildVlmRequestBody("https://media.example.com/v.mp4", null);
    expect(body.messages[0].content[0]).toMatchObject({ media_url: { sampling: { fps: VLM_UNKNOWN_DURATION_FPS } } });
  });
});

describe("verdict parsing matrix", () => {
  const parse = (content: unknown) => vlmVerdictFromContent(content);

  it("all false is clean", () => {
    expect(parse(JSON.stringify(CLEAN))).toEqual({
      ok: true,
      verdict: { ok: true, flagged: false, review: false, categories: [], reason: "clean" },
    });
  });

  it("allows whitespace around the object", () => {
    expect(parse(`\n  ${JSON.stringify(CLEAN)}  \n`)).toMatchObject({ ok: true, verdict: { flagged: false, review: false } });
  });

  for (const category of VLM_CATEGORIES) {
    it(`${category} true is flagged with that category`, () => {
      const result = parse(JSON.stringify({ ...CLEAN, [category]: true, reason: "x" }));
      expect(result).toEqual({
        ok: true,
        verdict: { ok: true, flagged: true, review: false, categories: [category], reason: "x" },
      });
    });
  }

  it("a category wins over unsure (flagged, not just held)", () => {
    const result = parse(JSON.stringify({ ...CLEAN, violence: true, hate: true, unsure: true }));
    expect(result).toMatchObject({ ok: true, verdict: { flagged: true, categories: ["violence", "hate"] } });
  });

  it("unsure with no category is review, never clean", () => {
    expect(parse(JSON.stringify({ ...CLEAN, unsure: true, reason: "too dark to tell" }))).toEqual({
      ok: true,
      verdict: { ok: true, flagged: false, review: true, categories: [], reason: "too dark to tell" },
    });
  });

  it("truncated JSON is not a verdict", () => {
    expect(parse(JSON.stringify(CLEAN).slice(0, 40))).toEqual({ ok: false, detail: "verdict is not valid JSON" });
  });

  it("invalid JSON is not a verdict", () => {
    expect(parse("sexual_explicit: false")).toMatchObject({ ok: false });
    expect(parse("{'sexual_explicit': false}")).toMatchObject({ ok: false });
  });

  it("extra text around the JSON is not a verdict", () => {
    expect(parse(`Here is the result: ${JSON.stringify(CLEAN)}`)).toMatchObject({ ok: false });
    expect(parse(`${JSON.stringify(CLEAN)} The video looks fine.`)).toMatchObject({ ok: false });
    expect(parse("```json\n" + JSON.stringify(CLEAN) + "\n```")).toMatchObject({ ok: false });
  });

  for (const key of [...VLM_CATEGORIES, "unsure", "reason"]) {
    it(`a missing ${key} is not a verdict`, () => {
      const partial: Record<string, unknown> = { ...CLEAN };
      delete partial[key];
      expect(parse(JSON.stringify(partial))).toMatchObject({ ok: false });
    });
  }

  it("mistyped fields are not a verdict", () => {
    expect(parse(JSON.stringify({ ...CLEAN, sexual_explicit: "false" }))).toMatchObject({ ok: false });
    expect(parse(JSON.stringify({ ...CLEAN, unsure: 0 }))).toMatchObject({ ok: false });
    expect(parse(JSON.stringify({ ...CLEAN, hate: null }))).toMatchObject({ ok: false });
    expect(parse(JSON.stringify({ ...CLEAN, reason: 5 }))).toMatchObject({ ok: false });
  });

  it("an unexpected extra key is not a verdict (a dropped category included)", () => {
    expect(parse(JSON.stringify({ ...CLEAN, drugs: false }))).toMatchObject({ ok: false });
    expect(parse(JSON.stringify({ ...CLEAN, self_harm: false }))).toMatchObject({ ok: false });
  });

  it("empty content, non-strings, arrays and primitives are not a verdict", () => {
    for (const content of ["", "   ", null, undefined, 42, {}, [CLEAN], JSON.stringify([CLEAN]), "true", "null"]) {
      expect(parse(content), JSON.stringify(content)).toMatchObject({ ok: false });
    }
  });

  it("cleans and caps the reason (one line, no control characters)", () => {
    const result = parse(JSON.stringify({ ...CLEAN, unsure: true, reason: `line one\nline\u0007two ${"x".repeat(500)}` }));
    if (!result.ok) throw new Error("expected a verdict");
    expect(result.verdict.reason).not.toMatch(/[\n\u0007]/);
    expect(result.verdict.reason.length).toBeLessThanOrEqual(VLM_REASON_MAX_CHARS);
  });
});

describe("nothing but a fully clean parse is ever clean", () => {
  const isClean = (content: unknown) => {
    const r = vlmVerdictFromContent(content);
    return r.ok && !r.verdict.flagged && !r.verdict.review;
  };

  it("of all 32 boolean combinations, only all-false is clean", () => {
    const keys = [...VLM_CATEGORIES, "unsure"] as const;
    let cleanCount = 0;
    for (let mask = 0; mask < 2 ** keys.length; mask++) {
      const verdict: Record<string, unknown> = { reason: "r" };
      keys.forEach((k, i) => (verdict[k] = Boolean(mask & (1 << i))));
      const clean = isClean(JSON.stringify(verdict));
      expect(clean, JSON.stringify(verdict)).toBe(mask === 0);
      if (clean) cleanCount += 1;
    }
    expect(cleanCount).toBe(1);
    expect(2 ** keys.length).toBe(32);
  });

  it("no malformed variant of a clean answer is clean", () => {
    const text = JSON.stringify(CLEAN);
    const variants: unknown[] = [
      "",
      text.slice(0, -1),
      text.slice(1),
      `${text},`,
      `[${text}]`,
      `${text}${text}`,
      `ok ${text}`,
      text.replace("false", '"false"'),
      text.replace('"unsure":false', '"unsure":"no"'),
      text.replace('"reason":"clean"', '"reason":null'),
      text.replace(',"reason":"clean"', ""),
      text.replace("}", ',"note":"x"}'),
      JSON.stringify({ result: CLEAN }),
      { ...CLEAN },
    ];
    for (const key of [...VLM_CATEGORIES, "unsure"]) {
      const missing: Record<string, unknown> = { ...CLEAN };
      delete missing[key];
      variants.push(JSON.stringify(missing), JSON.stringify({ ...CLEAN, [key]: 0 }), JSON.stringify({ ...CLEAN, [key]: "false" }));
    }
    for (const v of variants) expect(isClean(v), String(v)).toBe(false);
  });

  it("a response that did not finish with stop is never a verdict, even if its content is clean", () => {
    for (const finish of ["length", "content_filter", null, "STOP"]) {
      expect(vlmVerdictFromResponse(completion(JSON.stringify(CLEAN), finish)), String(finish)).toMatchObject({ ok: false });
    }
    const noFinish = { choices: [{ message: { content: JSON.stringify(CLEAN) } }] };
    expect(vlmVerdictFromResponse(noFinish)).toMatchObject({ ok: false, detail: "finish_reason missing" });
    for (const body of [null, {}, { choices: [] }, { choices: [null] }, { choices: "x" }, "text"]) {
      expect(vlmVerdictFromResponse(body), JSON.stringify(body)).toMatchObject({ ok: false });
    }
  });

  it("reads usage when present", () => {
    expect(vlmVerdictFromResponse(completion(JSON.stringify(CLEAN)))).toMatchObject({
      ok: true,
      verdict: { flagged: false, review: false, usage: { inputTokens: 4273, outputTokens: 89 } },
    });
  });
});

describe("hiveFailureForStatus / isProviderWideFailure", () => {
  it("treats key, credit, rate-limit and server errors as provider-wide", () => {
    for (const status of [401, 403, 402, 429, 500, 503]) {
      expect(isProviderWideFailure(hiveFailureForStatus(status)), String(status)).toBe(true);
    }
  });

  it("treats a paused or out-of-balance account as out of credit, whatever the status", () => {
    const paused =
      '{"status_code":405,"message":"Your Organization is currently paused. Please check your account balance, our terms and conditions, or contact support@thehive.ai for more information."}';
    expect(hiveFailureForStatus(405, paused)).toBe("out_of_credit");
    expect(hiveFailureForStatus(400, paused)).toBe("out_of_credit");
    expect(isProviderWideFailure(hiveFailureForStatus(405, paused))).toBe(true);
  });

  it("treats an unrecognised client error as provider-wide, never against the video", () => {
    for (const status of [404, 405, 409, 410]) {
      expect(isProviderWideFailure(hiveFailureForStatus(status)), String(status)).toBe(true);
    }
  });

  it("treats media errors (incl. a URL Hive's fetcher couldn't pull) as about the video", () => {
    for (const status of [400, 413, 415, 422]) {
      expect(hiveFailureForStatus(status), String(status)).toBe("rejected_media");
      expect(isProviderWideFailure("rejected_media")).toBe(false);
    }
  });

  it("names the common cases", () => {
    expect(hiveFailureForStatus(401)).toBe("unauthorized");
    expect(hiveFailureForStatus(403)).toBe("unauthorized");
    expect(hiveFailureForStatus(402)).toBe("out_of_credit");
    expect(hiveFailureForStatus(429)).toBe("rate_limited");
    expect(hiveFailureForStatus(502)).toBe("provider_error");
  });

  it("counts a missing key and an unreachable host as provider-wide, a timeout and a bad answer as about the video", () => {
    expect(isProviderWideFailure("not_configured")).toBe(true);
    expect(isProviderWideFailure("unreachable")).toBe(true);
    expect(isProviderWideFailure("timeout")).toBe(false);
    expect(isProviderWideFailure("bad_response")).toBe(false);
  });
});

describe("parseRetryAfterSeconds", () => {
  const now = Date.parse("2026-11-16T12:00:00Z");
  it("reads delta-seconds and HTTP dates", () => {
    expect(parseRetryAfterSeconds("120", now)).toBe(120);
    expect(parseRetryAfterSeconds(" 0 ", now)).toBe(0);
    expect(parseRetryAfterSeconds("Mon, 16 Nov 2026 12:30:00 GMT", now)).toBe(1800);
  });
  it("ignores missing, unreadable, past or absurd values", () => {
    expect(parseRetryAfterSeconds(null, now)).toBeUndefined();
    expect(parseRetryAfterSeconds("", now)).toBeUndefined();
    expect(parseRetryAfterSeconds("soon", now)).toBeUndefined();
    expect(parseRetryAfterSeconds("-5", now)).toBeUndefined();
    expect(parseRetryAfterSeconds("Mon, 16 Nov 2026 11:00:00 GMT", now)).toBeUndefined();
    expect(parseRetryAfterSeconds(String(10 * 24 * 3600), now)).toBeUndefined();
  });
});

describe("moderateVideo (HTTP)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
    const fn = vi.fn(impl);
    vi.stubGlobal("fetch", fn);
    return fn;
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("is not_configured without a key, and makes no call", async () => {
    vi.stubEnv("HIVE_API_KEY", "");
    const fetchFn = stubFetch(async () => json({}));
    expect(await moderateVideo("https://media.example.com/v.mp4")).toEqual({ ok: false, failure: "not_configured" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("POSTs the VLM request with the bearer key and the row's duration", async () => {
    vi.stubEnv("HIVE_API_KEY", "k");
    const fetchFn = stubFetch(async () => json(completion(JSON.stringify(CLEAN))));
    const result = await moderateVideo("https://media.example.com/v.mp4", { durationSeconds: 120 });
    expect(result).toMatchObject({ ok: true, flagged: false, review: false });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(HIVE_VLM_ENDPOINT);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(JSON.parse(String(init.body))).toEqual(buildVlmRequestBody("https://media.example.com/v.mp4", 120));
  });

  it("returns flagged and unsure verdicts", async () => {
    vi.stubEnv("HIVE_API_KEY", "k");
    stubFetch(async () => json(completion(JSON.stringify({ ...CLEAN, hate: true, reason: "a swastika flag" }))));
    expect(await moderateVideo("https://media.example.com/v.mp4", { durationSeconds: 10 })).toMatchObject({
      ok: true,
      flagged: true,
      categories: ["hate"],
      reason: "a swastika flag",
    });
    stubFetch(async () => json(completion(JSON.stringify({ ...CLEAN, unsure: true, reason: "very dark" }))));
    expect(await moderateVideo("https://media.example.com/v.mp4", { durationSeconds: 10 })).toMatchObject({
      ok: true,
      flagged: false,
      review: true,
      reason: "very dark",
    });
  });

  it("a cut-off, unparsable or empty answer is bad_response, never clean", async () => {
    vi.stubEnv("HIVE_API_KEY", "k");
    for (const body of [
      completion(JSON.stringify(CLEAN), "length"),
      completion("{\"sexual_explicit\": false"),
      completion(""),
      { error: "something" },
    ]) {
      stubFetch(async () => json(body));
      const result = await moderateVideo("https://media.example.com/v.mp4");
      expect(result, JSON.stringify(body)).toMatchObject({ ok: false, failure: "bad_response" });
    }
    stubFetch(async () => new Response("<html>oops</html>", { status: 200 }));
    expect(await moderateVideo("https://media.example.com/v.mp4")).toMatchObject({ ok: false, failure: "bad_response" });
  });

  it("maps HTTP errors: 429 with Retry-After, paused 405, 401/403, 5xx, 400 media", async () => {
    vi.stubEnv("HIVE_API_KEY", "k");
    const cases: Array<[number, string, Record<string, string>, object]> = [
      [429, '{"message":"rate limited"}', { "Retry-After": "900" }, { failure: "rate_limited", retryAfterSeconds: 900 }],
      [405, '{"message":"Your Organization is currently paused."}', {}, { failure: "out_of_credit" }],
      [401, '{"message":"Invalid or expired token"}', {}, { failure: "unauthorized" }],
      [403, "forbidden", {}, { failure: "unauthorized" }],
      [503, "unavailable", {}, { failure: "provider_error" }],
      [400, '{"message":"Unable to download media"}', {}, { failure: "rejected_media", detail: expect.stringContaining("HTTP 400") }],
    ];
    for (const [status, body, headers, expected] of cases) {
      stubFetch(async () => new Response(body, { status, headers }));
      expect(await moderateVideo("https://media.example.com/v.mp4"), String(status)).toMatchObject({ ok: false, ...expected });
    }
  });

  it("never echoes the key in an error detail", async () => {
    vi.stubEnv("HIVE_API_KEY", "secret-key-123");
    stubFetch(async () => new Response("bad token secret-key-123", { status: 401 }));
    const result = await moderateVideo("https://media.example.com/v.mp4");
    expect(JSON.stringify(result)).not.toContain("secret-key-123");
  });

  it("an unreachable host is unreachable", async () => {
    vi.stubEnv("HIVE_API_KEY", "k");
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await moderateVideo("https://media.example.com/v.mp4")).toEqual({ ok: false, failure: "unreachable" });
  });

  it("aborts at the shorter timeout the caller gives (never above 30s)", async () => {
    vi.useFakeTimers();
    vi.stubEnv("HIVE_API_KEY", "k");
    stubFetch(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted")))),
    );
    const pending = moderateVideo("https://media.example.com/v.mp4", { timeoutMs: 5_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toEqual({ ok: false, failure: "timeout" });
  });
});
