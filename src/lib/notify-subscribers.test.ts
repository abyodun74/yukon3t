import { describe, it, expect } from "vitest";
import { filterRecipients } from "@/lib/notify-subscribers";

const subs = [
  { subscriberId: "a" },
  { subscriberId: "b" },
  { subscriberId: "c" },
];

describe("filterRecipients", () => {
  it("returns everyone when no onlyRecipientIds is given", () => {
    expect(filterRecipients(subs)).toEqual(subs);
  });

  it("restricts to onlyRecipientIds when given", () => {
    expect(filterRecipients(subs, ["a", "c"])).toEqual([{ subscriberId: "a" }, { subscriberId: "c" }]);
  });

  it("returns nothing when onlyRecipientIds matches none of the subscribers", () => {
    expect(filterRecipients(subs, ["z"])).toEqual([]);
  });
});
