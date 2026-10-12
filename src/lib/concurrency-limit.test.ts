import { describe, expect, it } from "vitest";
import { createConcurrencyLimit } from "./concurrency-limit";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createConcurrencyLimit", () => {
  it("never runs more than max tasks at once and runs all of them", async () => {
    const limit = createConcurrencyLimit(4);
    let running = 0;
    let peak = 0;
    const results = await Promise.all(
      Array.from({ length: 17 }, (_, i) =>
        limit(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await tick();
          running -= 1;
          return i;
        }),
      ),
    );
    expect(peak).toBe(4);
    expect(results).toEqual(Array.from({ length: 17 }, (_, i) => i));
  });

  it("starts waiting tasks in arrival order as slots free up", async () => {
    const limit = createConcurrencyLimit(1);
    const gate = deferred();
    const started: string[] = [];
    const first = limit(async () => {
      started.push("first");
      await gate.promise;
    });
    const second = limit(async () => {
      started.push("second");
    });
    const third = limit(async () => {
      started.push("third");
    });
    await tick();
    expect(started).toEqual(["first"]);
    gate.resolve();
    await Promise.all([first, second, third]);
    expect(started).toEqual(["first", "second", "third"]);
  });

  it("frees the slot when a task throws, and passes the error on", async () => {
    const limit = createConcurrencyLimit(1);
    await expect(
      limit(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(limit(async () => "ok")).resolves.toBe("ok");
  });
});
