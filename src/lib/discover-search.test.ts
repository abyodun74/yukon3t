import { describe, expect, it } from "vitest";
import {
  DISCOVER_SEARCH_MAX_LENGTH,
  DISCOVER_SEARCH_MAX_PAGES,
  DISCOVER_SEARCH_MAX_RESULTS,
  DISCOVER_SEARCH_PAGE_SIZE,
  discoverSearchPage,
  discoverSearchState,
  discoverSearchUserWhere,
  normalizeDiscoverSearchQuery,
  pickDiscoverSearchConnection,
} from "@/lib/discover-search";

const ME = "cme00000000001";
const OTHER = "cot00000000001";

describe("normalizeDiscoverSearchQuery", () => {
  it("trims, collapses whitespace and drops a leading @", () => {
    expect(normalizeDiscoverSearchQuery("  Ada   Love  ")).toBe("Ada Love");
    expect(normalizeDiscoverSearchQuery("@ada_l")).toBe("ada_l");
    expect(normalizeDiscoverSearchQuery("@@ ada")).toBe("ada");
  });

  it("refuses anything shorter than two letters or digits", () => {
    expect(normalizeDiscoverSearchQuery("")).toBeNull();
    expect(normalizeDiscoverSearchQuery("a")).toBeNull();
    expect(normalizeDiscoverSearchQuery("@a")).toBeNull();
    expect(normalizeDiscoverSearchQuery(" a ")).toBeNull();
    expect(normalizeDiscoverSearchQuery("__")).toBeNull();
    expect(normalizeDiscoverSearchQuery("a_")).toBeNull();
    expect(normalizeDiscoverSearchQuery("ab")).toBe("ab");
    expect(normalizeDiscoverSearchQuery("42")).toBe("42");
  });

  it("can't be turned into a match-everything pattern", () => {
    expect(normalizeDiscoverSearchQuery("%%")).toBeNull();
    expect(normalizeDiscoverSearchQuery("%a%")).toBeNull();
    expect(normalizeDiscoverSearchQuery("a%b")).toBe("ab");
    expect(normalizeDiscoverSearchQuery("\\\\")).toBeNull();
  });

  it("accepts non-Latin names", () => {
    expect(normalizeDiscoverSearchQuery("أحمد")).toBe("أحمد");
    expect(normalizeDiscoverSearchQuery("José")).toBe("José");
  });

  it("cuts an over-long query instead of refusing it", () => {
    const query = normalizeDiscoverSearchQuery("x".repeat(500));
    expect(query).toHaveLength(DISCOVER_SEARCH_MAX_LENGTH);
  });

  it("ignores anything that isn't a string", () => {
    expect(normalizeDiscoverSearchQuery(undefined)).toBeNull();
    expect(normalizeDiscoverSearchQuery(42)).toBeNull();
    expect(normalizeDiscoverSearchQuery({ contains: "" })).toBeNull();
  });
});

describe("discoverSearchPage", () => {
  it("allows pages 1 to the cap only", () => {
    expect(DISCOVER_SEARCH_MAX_PAGES * DISCOVER_SEARCH_PAGE_SIZE).toBe(DISCOVER_SEARCH_MAX_RESULTS);
    expect(discoverSearchPage(1)).toBe(1);
    expect(discoverSearchPage(DISCOVER_SEARCH_MAX_PAGES)).toBe(DISCOVER_SEARCH_MAX_PAGES);
    expect(discoverSearchPage(DISCOVER_SEARCH_MAX_PAGES + 1)).toBeNull();
    expect(discoverSearchPage(0)).toBeNull();
    expect(discoverSearchPage(-1)).toBeNull();
    expect(discoverSearchPage(1.5)).toBeNull();
    expect(discoverSearchPage("2")).toBeNull();
    expect(discoverSearchPage(Number.NaN)).toBeNull();
  });
});

describe("discoverSearchUserWhere", () => {
  const where = discoverSearchUserWhere(ME, new Set(["cbl00000000001", "cbl00000000002"]), "ada");

  it("never returns the viewer or anyone blocked either way", () => {
    expect(where.id.notIn).toEqual([ME, "cbl00000000001", "cbl00000000002"]);
  });

  it("returns only active, named, discoverable, verified members", () => {
    expect(where.status).toBe("ACTIVE");
    expect(where.name).toEqual({ not: null });
    expect(where.discoverable).toBe(true);
    // Neither email nor phone verified = excluded.
    expect(where.NOT).toEqual({ emailVerified: null, phoneVerifiedAt: null });
  });

  it("never returns a site admin or the guest-preview identity", () => {
    expect(where.isAdmin).toBe(false);
    expect(where.isGuestPreview).toBe(false);
  });

  it("matches the name or username only, by substring, never a private column", () => {
    expect(where.OR).toEqual([
      { name: { contains: "ada", mode: "insensitive" } },
      { username: { contains: "ada", mode: "insensitive" } },
    ]);
    const columns = JSON.stringify(where);
    for (const column of ["email\"", "phone\"", "birthDate", "bio", "equals"]) expect(columns).not.toContain(column);
  });
});

describe("discoverSearchState", () => {
  it("reads the viewer's side of the connection", () => {
    expect(discoverSearchState(undefined, ME)).toBe("none");
    expect(discoverSearchState({ status: "ACCEPTED", requesterId: OTHER }, ME)).toBe("connected");
    expect(discoverSearchState({ status: "ACCEPTED", requesterId: ME }, ME)).toBe("connected");
    expect(discoverSearchState({ status: "PENDING", requesterId: ME }, ME)).toBe("requested");
    expect(discoverSearchState({ status: "PENDING", requesterId: OTHER }, ME)).toBe("incoming");
  });

  it("lets a declined request be sent again", () => {
    expect(discoverSearchState({ status: "DECLINED", requesterId: ME }, ME)).toBe("none");
    expect(discoverSearchState({ status: "DECLINED", requesterId: OTHER }, ME)).toBe("none");
  });
});

describe("pickDiscoverSearchConnection", () => {
  it("prefers accepted, then pending, when the pair has two rows", () => {
    const declined = { id: "d", status: "DECLINED" as const };
    const pending = { id: "p", status: "PENDING" as const };
    const accepted = { id: "a", status: "ACCEPTED" as const };
    expect(pickDiscoverSearchConnection([declined, pending])).toBe(pending);
    expect(pickDiscoverSearchConnection([pending, accepted])).toBe(accepted);
    expect(pickDiscoverSearchConnection([declined])).toBe(declined);
    expect(pickDiscoverSearchConnection([])).toBeUndefined();
  });
});
