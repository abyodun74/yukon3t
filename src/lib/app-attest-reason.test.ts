import { describe, expect, it } from "vitest";
import { shapeFailureReason } from "./app-attest-shared";

describe("shapeFailureReason (client failure-reason shaping)", () => {
  it("drops the boilerplate prefix (both apostrophes) and collapses whitespace", () => {
    expect(shapeFailureReason("The operation couldn’t be completed. Foo   bar\n baz")).toBe("Foo bar baz");
    expect(shapeFailureReason("The operation couldn't be completed. (com.x error 3.)")).toBe("(com.x error 3.)");
  });

  it("strips control characters", () => {
    expect(shapeFailureReason("a\u0000b\u001bc\u0085d")).toBe("a b c d");
  });

  it("keeps a backoff marker and the underlying error tail", () => {
    const msg =
      "The operation couldn’t be completed. Too many attempts. Underlying error: The operation couldn’t be completed. (com.apple.devicecheck.error error 1.)";
    expect(shapeFailureReason(msg)).toBe("backoff|(com.apple.devicecheck.error error 1.)");
  });

  it("caps at 240 characters", () => {
    expect(shapeFailureReason("x".repeat(1000))).toHaveLength(240);
    expect(shapeFailureReason(`Too many attempts. Underlying error: ${"y".repeat(1000)}`)).toHaveLength(240);
  });
});
