import { describe, expect, it } from "vitest";
import { circleShareMessage, circleShareUrl, isCircleShareable } from "@/lib/circle-share";

describe("circle share rules", () => {
  it("shares PUBLIC Circles only", () => {
    expect(isCircleShareable({ visibility: "PUBLIC" })).toBe(true);
    expect(isCircleShareable({ visibility: "PRIVATE" })).toBe(false);
  });

  it("always links the canonical production host", () => {
    expect(circleShareUrl("lagos-runners")).toBe("https://yukon3t.com/circles/lagos-runners");
    expect(circleShareUrl("a b")).toBe("https://yukon3t.com/circles/a%20b");
  });

  it("writes the name and the link on its own line, nothing else", () => {
    expect(circleShareMessage({ name: "  Lagos\n Runners ", slug: "lagos-runners" })).toBe(
      "Lagos Runners\nhttps://yukon3t.com/circles/lagos-runners",
    );
    expect(circleShareMessage({ name: "   ", slug: "x" })).toBe("https://yukon3t.com/circles/x");
  });
});
