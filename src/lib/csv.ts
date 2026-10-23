/**
 * Writing CSV files people open in a spreadsheet (the Circle event export, actions/circle-event-organizer.ts). Pure
 * and client-safe.
 *
 * - Formula injection: a cell starting with = + - @, a tab or a carriage return is treated as a formula by Excel,
 *   LibreOffice and Google Sheets, so member-written text ("=HYPERLINK(...)" as a display name) could run as one in
 *   the organizer's spreadsheet. Such a cell gets a leading apostrophe (OWASP's advice), which spreadsheets show as
 *   plain text. Leading spaces don't protect a formula in every spreadsheet, so they're looked past.
 * - Quoting per RFC 4180: a cell holding a comma, a double quote or a line break is wrapped in double quotes, with
 *   each double quote doubled. Rows end with CRLF.
 * - A file starts with a UTF-8 byte-order mark so Excel reads accents and Arabic as UTF-8 (csvFileContent).
 */

export const CSV_BOM = "﻿";

const FORMULA_START = /^[\s ]*[=+\-@\t\r＝＋－＠]/;

/** A cell's text with formula injection neutralized (a leading apostrophe when it could start a formula). */
export function neutralizeCsvCell(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** One cell as it is written into a CSV row: neutralized, then quoted when needed. */
export function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = neutralizeCsvCell(String(value));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows (the first one being the header) as CSV text, each row ended by CRLF. No byte-order mark (csvFileContent adds it). */
export function toCsv(rows: readonly (readonly (string | number | boolean | null | undefined)[])[]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n") + (rows.length ? "\r\n" : "");
}

/** What goes into a downloaded .csv file: the text after a UTF-8 byte-order mark. */
export function csvFileContent(csv: string): string {
  return CSV_BOM + csv;
}

/**
 * A safe download name: lower-case ASCII letters, digits and single hyphens from `base` (accents dropped, anything
 * else becoming a hyphen), at most 60 characters, `fallback` when nothing is left, then "-<suffix>" and ".csv". Never
 * a path, a dot file, a quote or a control character, whatever the event's title says.
 */
export function csvFileName(base: string, suffix: string | null, fallback = "export"): string {
  const slug = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const stem = slug(base).slice(0, 60).replace(/-+$/g, "") || slug(fallback) || "export";
  const tail = suffix ? slug(suffix).slice(0, 40) : "";
  return `${stem}${tail ? `-${tail}` : ""}.csv`;
}
