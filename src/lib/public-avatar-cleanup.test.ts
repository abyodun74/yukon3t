import { describe, expect, it } from "vitest";
import { parseAvatarMigrationMap, verifyPublicAvatarForDeletion } from "@/lib/public-avatar-cleanup";

const OWNER = "ckabc123";
const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const KEY = `avatar/${OWNER}/${UUID}.jpg`;
const ROUTE = `/api/avatar/${OWNER}/${UUID}.jpg`;
const entry = { userId: OWNER, oldUrl: `https://pub-1.r2.dev/${KEY}`, newUrl: ROUTE, migratedAt: "2026-10-19T00:00:00.000Z" };
const ok = { key: KEY, publicSize: 1234, privateCopy: { size: 1234, contentType: "image/jpeg" }, referencedBy: [], mappingEntry: entry };

describe("verifyPublicAvatarForDeletion", () => {
  it("allows a migrated avatar with a same-size private copy and no reference", () => {
    expect(verifyPublicAvatarForDeletion(ok)).toEqual({ key: KEY, deletable: true, routeUrl: ROUTE, inMapping: true });
  });

  it("allows one missing from the mapping file when the private copy checks out", () => {
    expect(verifyPublicAvatarForDeletion({ ...ok, mappingEntry: undefined })).toMatchObject({ deletable: true, inMapping: false });
  });

  it("refuses anything that is still referenced", () => {
    const v = verifyPublicAvatarForDeletion({ ...ok, referencedBy: ['"User"."avatarUrl"'] });
    expect(v.deletable).toBe(false);
  });

  it("refuses without a private copy, when the check failed, or when the copy is empty or a different size", () => {
    for (const privateCopy of [null, "error" as const, { size: 0, contentType: "image/jpeg" }, { size: 99, contentType: "image/jpeg" }]) {
      expect(verifyPublicAvatarForDeletion({ ...ok, privateCopy }).deletable, JSON.stringify(privateCopy)).toBe(false);
    }
  });

  it("refuses when the mapping file disagrees with the key", () => {
    expect(verifyPublicAvatarForDeletion({ ...ok, mappingEntry: { ...entry, newUrl: `/api/avatar/${OWNER}/other.jpg` } }).deletable).toBe(false);
    expect(verifyPublicAvatarForDeletion({ ...ok, mappingEntry: { ...entry, userId: "someone-else" } }).deletable).toBe(false);
  });

  it("refuses keys that aren't exactly an avatar key this app minted", () => {
    for (const key of [
      `avatar/${OWNER}/${UUID}.gif`,
      `avatar/${OWNER}/${UUID}-t.jpg`,
      `avatar/${OWNER}/sub/${UUID}.jpg`,
      `avatar/${OWNER}/../${UUID}.jpg`,
      `post-image/${OWNER}/${UUID}.jpg`,
      `avatar/${OWNER}/`,
    ]) {
      expect(verifyPublicAvatarForDeletion({ ...ok, key, mappingEntry: undefined }).deletable, key).toBe(false);
    }
  });
});

describe("parseAvatarMigrationMap", () => {
  it("indexes entries by the public key, keeping the first record per key", () => {
    const later = { ...entry, migratedAt: "2026-10-20T00:00:00.000Z" };
    const map = parseAvatarMigrationMap([entry, later]);
    expect(map.size).toBe(1);
    expect(map.get(KEY)).toBe(entry);
  });

  it("throws on anything that isn't a well-formed mapping file", () => {
    expect(() => parseAvatarMigrationMap({})).toThrow();
    expect(() => parseAvatarMigrationMap([{ userId: OWNER }])).toThrow();
    expect(() => parseAvatarMigrationMap([{ ...entry, oldUrl: "not a url" }])).toThrow();
    expect(() => parseAvatarMigrationMap([{ ...entry, oldUrl: `http://pub-1.r2.dev/${KEY}` }])).toThrow();
  });
});
