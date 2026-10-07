import { describe, it, expect } from "vitest";
import { filterRecipients } from "@/lib/notify-subscribers";

const subs = [
  { subscriberId: "a" },
  { subscriberId: "b" },
  { subscriberId: "c" },
];

describe("filterRecipients", () => {
  it("returns everyone when neither option is given", () => {
    expect(filterRecipients(subs)).toEqual(subs);
  });

  it("restricts to onlyRecipientIds when given", () => {
    expect(filterRecipients(subs, ["a", "c"])).toEqual([{ subscriberId: "a" }, { subscriberId: "c" }]);
  });

  it("drops excludeRecipientIds when given", () => {
    expect(filterRecipients(subs, undefined, ["b"])).toEqual([{ subscriberId: "a" }, { subscriberId: "c" }]);
  });

  it("applies onlyRecipientIds and excludeRecipientIds together", () => {
    expect(filterRecipients(subs, ["a", "b"], ["b"])).toEqual([{ subscriberId: "a" }]);
  });

  it("ignores an empty excludeRecipientIds list", () => {
    expect(filterRecipients(subs, undefined, [])).toEqual(subs);
  });
});
