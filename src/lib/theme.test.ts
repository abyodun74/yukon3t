import { describe, it, expect } from "vitest";
import { parseTheme } from "@/lib/theme";

describe("parseTheme", () => {
  it("accepts known theme values", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBe("system");
  });

  it("falls back to system for anything unrecognized", () => {
    expect(parseTheme("solarized")).toBe("system");
    expect(parseTheme("")).toBe("system");
    expect(parseTheme(undefined)).toBe("system");
    expect(parseTheme(null)).toBe("system");
  });
});
