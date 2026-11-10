import { describe, expect, it } from "vitest";
import {
  buildInviteContactRows,
  matchesInviteSearch,
  mergeInviteContacts,
  normalizeInviteNumber,
  type RawInviteContact,
} from "@/lib/invite-contacts";

describe("normalizeInviteNumber", () => {
  it("reads every common formatting of one US number as the same E.164 key", () => {
    const forms = ["+1 415-555-0132", "(415) 555-0132", "415.555.0132", "4155550132", "+14155550132", "1 (415) 555-0132"];
    const keys = forms.map((f) => normalizeInviteNumber(f, "US")?.key);
    expect(new Set(keys)).toEqual(new Set(["+14155550132"]));
    expect(normalizeInviteNumber("(415) 555-0132", "US")?.e164).toBe("+14155550132");
  });

  it("uses the default country only for numbers without a country code", () => {
    expect(normalizeInviteNumber("07400 123456", "GB")?.key).toBe("+447400123456");
    expect(normalizeInviteNumber("+44 7400 123456", "US")?.key).toBe("+447400123456");
  });

  it("reads a 00 international prefix as +", () => {
    expect(normalizeInviteNumber("0044 7400 123456", "US")?.key).toBe("+447400123456");
    expect(normalizeInviteNumber("00 234 803 123 4567", "GB")?.key).toBe("+2348031234567");
  });

  it("falls back to digits for something it can't read, and drops what has too few digits", () => {
    expect(normalizeInviteNumber("72-345", "US")).toEqual({ key: "72345", e164: null, display: "72-345" });
    expect(normalizeInviteNumber("12", "US")).toBeNull();
    expect(normalizeInviteNumber("  ", "US")).toBeNull();
    expect(normalizeInviteNumber(null, "US")).toBeNull();
  });

  it("treats an unknown default country as the app default", () => {
    expect(normalizeInviteNumber("(415) 555-0132", null)?.key).toBe("+14155550132");
    expect(normalizeInviteNumber("(415) 555-0132", "ZZ")?.key).toBe("+14155550132");
  });
});

describe("buildInviteContactRows", () => {
  it("lists one number once when an address book synced from several accounts repeats it", () => {
    const contacts: RawInviteContact[] = [
      {
        name: "Ada Lovelace",
        phones: [
          { number: "+1 415-555-0132", type: "mobile" },
          { number: "(415) 555-0132", type: "other" },
          { number: "4155550132", type: "mobile" },
        ],
      },
    ];
    const rows = buildInviteContactRows(contacts, "US");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "tel:+14155550132", name: "Ada Lovelace", tel: "+14155550132", kind: null });
  });

  it("merges the same person saved twice (iCloud + Google) into one row", () => {
    const rows = buildInviteContactRows(
      [
        { name: "Ada Lovelace", phones: [{ number: "+14155550132", type: "mobile" }] },
        { name: " Ada  Lovelace ", phones: [{ number: "415 555 0132", type: "mobile" }] },
      ],
      "US",
    );
    expect(rows.map((r) => r.id)).toEqual(["tel:+14155550132"]);
  });

  it("never shows a number twice even under two different names, and keeps a name over none", () => {
    const rows = buildInviteContactRows(
      [
        { name: null, phones: [{ number: "4155550132" }] },
        { name: "Mom", phones: [{ number: "+1 415 555 0132" }] },
        { name: "Mother", phones: [{ number: "(415) 555-0132" }] },
      ],
      "US",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Mom");
  });

  it("keeps a person's distinct numbers as separate rows, labelled by type, mobile first", () => {
    const rows = buildInviteContactRows(
      [
        {
          name: "Grace Hopper",
          phones: [
            { number: "+1 212 555 0100", type: "work" },
            { number: "+1 646 555 0199", type: "mobile" },
            { number: "+1 718 555 0123", type: "custom", label: "Lake house" },
          ],
        },
        { name: "Alan Turing", phones: [{ number: "+44 7400 123456", type: "mobile" }] },
      ],
      "US",
    );
    expect(rows.map((r) => [r.name, r.tel, r.kind, r.customLabel])).toEqual([
      ["Alan Turing", "+447400123456", null, null],
      ["Grace Hopper", "+16465550199", "mobile", null],
      ["Grace Hopper", "+17185550123", "other", "Lake house"],
      ["Grace Hopper", "+12125550100", "work", null],
    ]);
  });

  it("prefers the specific type when one account lists the number as 'other'", () => {
    const rows = buildInviteContactRows(
      [
        {
          name: "Ada",
          phones: [
            { number: "4155550132", type: "other" },
            { number: "+14155550132", type: "mobile" },
            { number: "+14155550199", type: "home" },
          ],
        },
      ],
      "US",
    );
    expect(rows.map((r) => r.kind)).toEqual(["mobile", "home"]);
  });

  it("skips fax numbers, empty numbers and contacts without phones", () => {
    const rows = buildInviteContactRows(
      [
        { name: "Office", phones: [{ number: "+1 212 555 0100", type: "fax_work" }] },
        { name: "Blank", phones: [{ number: "" }, { number: null }] },
        { name: "Nobody", phones: [] },
      ],
      "US",
    );
    expect(rows).toEqual([]);
  });

  it("gives unique, stable ids across separate builds (picker reopened)", () => {
    const contacts: RawInviteContact[] = [
      { name: "B", phones: [{ number: "+14155550132" }, { number: "+14155550133" }] },
      { name: "A", phones: [{ number: "(415) 555-0134" }] },
      { name: null, phones: [{ number: "+447400123456" }] },
    ];
    const first = buildInviteContactRows(contacts, "US").map((r) => r.id);
    const second = buildInviteContactRows([...contacts].reverse(), "US").map((r) => r.id);
    expect(new Set(first).size).toBe(first.length);
    expect(second).toEqual(first);
    // Unnamed sort last.
    expect(first[first.length - 1]).toBe("tel:+447400123456");
  });
});

describe("mergeInviteContacts", () => {
  const [ada, grace] = buildInviteContactRows(
    [
      { name: "Ada", phones: [{ number: "+14155550132" }] },
      { name: "Grace", phones: [{ number: "+16465550199" }] },
    ],
    "US",
  );

  it("doesn't add a number that's already in the list (picked twice, or typed and picked)", () => {
    const typed = { ...ada, name: null };
    const merged = mergeInviteContacts([typed], [ada, grace, grace]);
    expect(merged.map((c) => c.id)).toEqual([ada.id, grace.id]);
    expect(merged[0].name).toBe("Ada");
  });

  it("keeps the existing order and doesn't mutate its input", () => {
    const current = [grace];
    const merged = mergeInviteContacts(current, [ada]);
    expect(merged.map((c) => c.name)).toEqual(["Grace", "Ada"]);
    expect(current).toEqual([grace]);
  });
});

describe("matchesInviteSearch", () => {
  const [row] = buildInviteContactRows([{ name: "Ada Lovelace", phones: [{ number: "(415) 555-0132" }] }], "US");

  it("matches by name or by number in any formatting", () => {
    expect(matchesInviteSearch(row, "love")).toBe(true);
    expect(matchesInviteSearch(row, "415-555")).toBe(true);
    expect(matchesInviteSearch(row, "4155550")).toBe(true);
    expect(matchesInviteSearch(row, "")).toBe(true);
    expect(matchesInviteSearch(row, "grace")).toBe(false);
    expect(matchesInviteSearch(row, "999")).toBe(false);
  });
});
