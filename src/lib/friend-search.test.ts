import { describe, expect, it } from "vitest";
import { filterBySearch, normalizeSearchQuery, normalizeSearchText } from "./friend-search";

type Person = { name: string; username?: string | null };
const fields = (p: Person) => [p.name, p.username];

const people: Person[] = [
  { name: "José García", username: "jose_g" },
  { name: "Biodun", username: "bio" },
  { name: "Orange girl", username: null },
  { name: "King_Gem", username: "kinggem" },
  { name: "محمد علي", username: "mohamed" },
  { name: "Zoë", username: "zoe99" },
  { name: "Admin" },
];

describe("normalizeSearchText", () => {
  it("lower-cases, strips accents and trims", () => {
    expect(normalizeSearchText("  JoSÉ ")).toBe("jose");
    expect(normalizeSearchText("Zoë")).toBe("zoe");
  });
  it("leaves Arabic letters alone but drops tashkeel", () => {
    expect(normalizeSearchText("مُحَمَّد")).toBe("محمد");
  });
});

describe("normalizeSearchQuery", () => {
  it("drops a leading @ and whitespace", () => {
    expect(normalizeSearchQuery("  @Bio ")).toBe("bio");
    expect(normalizeSearchQuery("@")).toBe("");
  });
});

describe("filterBySearch", () => {
  it("returns everyone for an empty or whitespace query", () => {
    expect(filterBySearch(people, "", fields)).toEqual(people);
    expect(filterBySearch(people, "   ", fields)).toEqual(people);
    expect(filterBySearch(people, "@", fields)).toEqual(people);
  });
  it("matches display names case-insensitively, anywhere in the name", () => {
    expect(filterBySearch(people, "ORANGE", fields).map((p) => p.name)).toEqual(["Orange girl"]);
    expect(filterBySearch(people, "gem", fields).map((p) => p.name)).toEqual(["King_Gem"]);
  });
  it("matches usernames, with or without @", () => {
    expect(filterBySearch(people, "kinggem", fields).map((p) => p.name)).toEqual(["King_Gem"]);
    expect(filterBySearch(people, "@mohamed", fields).map((p) => p.name)).toEqual(["محمد علي"]);
  });
  it("is diacritic-insensitive in both directions", () => {
    expect(filterBySearch(people, "Jose", fields).map((p) => p.name)).toEqual(["José García"]);
    expect(filterBySearch(people, "josé", fields).map((p) => p.name)).toEqual(["José García"]);
    expect(filterBySearch(people, "garcia", fields).map((p) => p.name)).toEqual(["José García"]);
    expect(filterBySearch(people, "zoe", fields).map((p) => p.name)).toEqual(["Zoë"]);
  });
  it("matches Arabic text", () => {
    expect(filterBySearch(people, "علي", fields).map((p) => p.name)).toEqual(["محمد علي"]);
    expect(filterBySearch(people, "مُحَمَّد", fields).map((p) => p.name)).toEqual(["محمد علي"]);
  });
  it("trims the query", () => {
    expect(filterBySearch(people, "  bio  ", fields).map((p) => p.name)).toEqual(["Biodun"]);
  });
  it("handles null usernames and returns [] for no match", () => {
    expect(filterBySearch(people, "nobody-here", fields)).toEqual([]);
  });
  it("keeps the original order and does not mutate the input", () => {
    const copy = [...people];
    const out = filterBySearch(people, "a", fields);
    expect(people).toEqual(copy);
    expect(out.map((p) => p.name)).toEqual(people.filter((p) => out.includes(p)).map((p) => p.name));
  });
});
