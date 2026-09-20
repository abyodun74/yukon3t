import { describe, expect, it } from "vitest";
import { checkSubCircleParent, subCircleVisibility } from "./circle-hierarchy";

describe("checkSubCircleParent", () => {
  const main = { createdById: "owner", parentId: null };

  it("lets the main Circle's owner add a sub-circle", () => {
    expect(checkSubCircleParent(main, "owner")).toBe("ok");
  });

  it("refuses anyone else, including someone who is merely a member", () => {
    expect(checkSubCircleParent(main, "someone-else")).toBe("forbidden");
  });

  it("refuses a parent that doesn't exist", () => {
    expect(checkSubCircleParent(null, "owner")).toBe("not_found");
  });

  it("allows only one level: a sub-circle can't have sub-circles, even for its owner", () => {
    const sub = { createdById: "owner", parentId: "some-main" };
    expect(checkSubCircleParent(sub, "owner")).toBe("not_top_level");
  });

  it("reports 'not top level' before 'forbidden' so the nesting rule is never masked", () => {
    const sub = { createdById: "owner", parentId: "some-main" };
    expect(checkSubCircleParent(sub, "someone-else")).toBe("not_top_level");
  });
});

describe("subCircleVisibility", () => {
  it("keeps the requested visibility under a public main Circle", () => {
    expect(subCircleVisibility("PUBLIC", "PUBLIC")).toBe("PUBLIC");
    expect(subCircleVisibility("PUBLIC", "PRIVATE")).toBe("PRIVATE");
  });

  it("forces PRIVATE under a private main Circle, whatever was requested", () => {
    expect(subCircleVisibility("PRIVATE", "PUBLIC")).toBe("PRIVATE");
    expect(subCircleVisibility("PRIVATE", "PRIVATE")).toBe("PRIVATE");
  });
});
