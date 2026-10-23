import { describe, expect, it } from "vitest";
import { CSV_BOM, csvFileContent, csvFileName, escapeCsvCell, neutralizeCsvCell, toCsv } from "@/lib/csv";

describe("neutralizeCsvCell (formula injection)", () => {
  it("prefixes an apostrophe to anything a spreadsheet would read as a formula", () => {
    for (const value of ["=1+1", "+1", "-1", "@SUM(A1)", "\tcmd", "\r=x", '=HYPERLINK("http://evil","x")']) {
      expect(neutralizeCsvCell(value)).toBe(`'${value}`);
    }
  });
  it("looks past leading spaces, and catches the full-width forms", () => {
    expect(neutralizeCsvCell("  =1+1")).toBe("'  =1+1");
    expect(neutralizeCsvCell("＝1+1")).toBe("'＝1+1");
  });
  it("leaves ordinary text alone", () => {
    for (const value of ["Ada Lovelace", "ada@example", "a=b", "", "Zoë", "محمد"]) {
      expect(neutralizeCsvCell(value)).toBe(value);
    }
  });
});

describe("escapeCsvCell", () => {
  it("quotes commas, quotes and line breaks, doubling inner quotes", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
  });
  it("neutralizes before quoting, so a quoted formula is still text", () => {
    expect(escapeCsvCell('=cmd|" /C calc"!A0')).toBe(`"'=cmd|"" /C calc""!A0"`);
    expect(escapeCsvCell("\r=1")).toBe(`"'\r=1"`);
  });
  it("writes null/undefined as empty and numbers/booleans as text", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
    expect(escapeCsvCell(3)).toBe("3");
    expect(escapeCsvCell(-3)).toBe("'-3");
    expect(escapeCsvCell(true)).toBe("true");
  });
});

describe("toCsv and csvFileContent", () => {
  it("joins rows with CRLF, ending with one", () => {
    expect(toCsv([["a", "b"], ["c,d", "e"]])).toBe('a,b\r\n"c,d",e\r\n');
    expect(toCsv([])).toBe("");
  });
  it("starts a file with a UTF-8 byte-order mark", () => {
    expect(CSV_BOM).toBe("﻿");
    expect(csvFileContent("a\r\n")).toBe("﻿a\r\n");
    expect(new TextEncoder().encode(csvFileContent("")).slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
  });
});

describe("csvFileName", () => {
  it("makes a lower-case ASCII slug with the suffix", () => {
    expect(csvFileName("Book Club: Night #3!", "2026-10-23")).toBe("book-club-night-3-2026-10-23.csv");
    expect(csvFileName("Café Crème", null)).toBe("cafe-creme.csv");
  });
  it("never yields a path, a dot file, quotes or control characters", () => {
    const name = csvFileName('../../etc/"passwd"\r\n\u0000', "x");
    expect(name).toBe("etc-passwd-x.csv");
    expect(name).not.toMatch(/[\\/"\r\n\u0000]|^\./);
  });
  it("falls back when nothing usable is left, and caps the length", () => {
    expect(csvFileName("محمد", "2026-10-23", "event")).toBe("event-2026-10-23.csv");
    expect(csvFileName("", null)).toBe("export.csv");
    expect(csvFileName("a".repeat(300), "2026-10-23").length).toBeLessThanOrEqual(60 + 1 + 10 + 4);
  });
});
