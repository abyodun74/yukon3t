import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";
import { resolvePhoneCountry } from "@/lib/phone-number";

// The "invite by text" contact list (invite-panel.tsx): turns what the phone's address book hands back into one row
// per phone number. Pure and client-safe; tests in invite-contacts.test.ts.
//
// Why the list used to show the same person/number several times:
// - An address book merges several accounts (Google, iCloud, Exchange, WhatsApp/Signal sync, the SIM) into one
//   contact, and each account contributes its own copy of the number, so one contact comes back with
//   "+1 415-555-0100", "(415) 555-0100" and "4155550100" in its phone list. Each was a row.
// - The same person saved twice (once per account the OS didn't link) came back as two contacts with the same number.
// - Opening the picker again, or adding a number by hand that was already picked, appended it again.
// Every number is now normalized to E.164 (the request's country fills in a missing country code, a leading "00" is
// read as "+") and kept once; distinct numbers of one person stay separate rows, labelled with their type.

/** What the list labels a number with when one person has several. */
export type InvitePhoneKind = "mobile" | "home" | "work" | "other";

export type InviteContact = {
  /** `tel:<normalized number>`: stable across picker opens and unique in any list built here (React key, selection). */
  id: string;
  name: string | null;
  /** E.164 when the number could be read, otherwise "+"/digits as typed: what the sms: link dials. */
  tel: string;
  /** E.164 only when the number is a possible number; WhatsApp needs it. */
  e164: string | null;
  /** How the row shows the number (international format when it could be read). */
  display: string;
  /** Set only when the same name has more than one number in the list; null otherwise. */
  kind: InvitePhoneKind | null;
  /** The address book's own label for a custom-type number ("Grandma's cell"), shown instead of `kind`. */
  customLabel: string | null;
};

/** One contact as either picker hands it back. `type` is @capacitor-community/contacts' PhoneType string. */
export type RawInviteContact = {
  name: string | null | undefined;
  phones: Array<{ number: string | null | undefined; type?: string | null; label?: string | null }>;
};

export type NormalizedInviteNumber = { key: string; e164: string | null; display: string };

const MIN_DIGITS = 3;

/**
 * The comparison key for one phone number, plus how to dial and show it. Null for something with too few digits to be
 * a number. `defaultCountry` is used only for a number written without a country code.
 */
export function normalizeInviteNumber(
  raw: string | null | undefined,
  defaultCountry?: string | null,
): NormalizedInviteNumber | null {
  let text = (raw ?? "").trim();
  if (!text) return null;
  // "00" is the international prefix almost everywhere outside North America: "0044 20…" is "+44 20…".
  if (/^00[1-9]/.test(text.replace(/[\s().-]/g, ""))) text = `+${text.replace(/[\s().-]/g, "").slice(2)}`;
  const parsed = text.startsWith("+")
    ? parsePhoneNumberFromString(text)
    : parsePhoneNumberFromString(text, resolvePhoneCountry(defaultCountry) as CountryCode);
  if (parsed && parsed.isPossible()) {
    return { key: parsed.number, e164: parsed.number, display: parsed.formatInternational() };
  }
  const digits = text.replace(/\D/g, "");
  if (digits.length < MIN_DIGITS) return null;
  const key = text.startsWith("+") ? `+${digits}` : digits;
  return { key, e164: null, display: text };
}

/** Maps a contacts-plugin phone type to the label the list shows; fax numbers can't take a text and are skipped. */
function phoneKind(type: string | null | undefined): InvitePhoneKind | "fax" {
  switch (type) {
    case "mobile":
      return "mobile";
    case "home":
      return "home";
    case "work":
      return "work";
    case "fax_home":
    case "fax_work":
      return "fax";
    default:
      return "other";
  }
}

const KIND_ORDER: Record<InvitePhoneKind, number> = { mobile: 0, other: 1, home: 2, work: 3 };

type Draft = Omit<InviteContact, "kind" | "customLabel"> & { phoneKind: InvitePhoneKind; custom: string | null };

function cleanName(name: string | null | undefined): string | null {
  const trimmed = (name ?? "").replace(/\s+/g, " ").trim();
  return trimmed || null;
}

/**
 * One row per distinct phone number across every contact, sorted by name (unnamed last), a person's mobile first.
 * When the same number belongs to several contacts the first one with a name keeps it.
 */
export function buildInviteContactRows(contacts: RawInviteContact[], defaultCountry?: string | null): InviteContact[] {
  const byKey = new Map<string, Draft>();
  for (const contact of contacts) {
    const name = cleanName(contact.name);
    for (const phone of contact.phones ?? []) {
      const kind = phoneKind(phone.type);
      if (kind === "fax") continue;
      const normalized = normalizeInviteNumber(phone.number, defaultCountry);
      if (!normalized) continue;
      const existing = byKey.get(normalized.key);
      if (existing) {
        if (!existing.name && name) existing.name = name;
        // The same number listed twice by one person, once as "other" by one account and once as "mobile" by another:
        // keep the more specific type.
        if (existing.phoneKind === "other" && kind !== "other" && existing.name === name) existing.phoneKind = kind;
        continue;
      }
      const custom = phone.type === "custom" ? cleanName(phone.label) : null;
      byKey.set(normalized.key, {
        id: `tel:${normalized.key}`,
        name,
        tel: normalized.e164 ?? normalized.key,
        e164: normalized.e164,
        display: normalized.display,
        phoneKind: kind,
        custom,
      });
    }
  }

  const drafts = [...byKey.values()];
  const perName = new Map<string, number>();
  for (const d of drafts) if (d.name) perName.set(d.name, (perName.get(d.name) ?? 0) + 1);

  const rows: InviteContact[] = drafts.map(({ phoneKind: kind, custom, ...row }) => {
    const labelled = row.name !== null && (perName.get(row.name) ?? 0) > 1;
    return { ...row, kind: labelled ? kind : null, customLabel: labelled ? custom : null };
  });
  const order = (r: InviteContact) => (r.kind ? KIND_ORDER[r.kind] : 0);
  return rows.sort((a, b) => {
    if (a.name !== b.name) {
      if (a.name === null) return 1;
      if (b.name === null) return -1;
      const byName = a.name.localeCompare(b.name);
      if (byName !== 0) return byName;
    }
    return order(a) - order(b) || a.display.localeCompare(b.display);
  });
}

/**
 * Adds picked rows to the list already chosen, never the same number twice (keeps the earlier row and its position;
 * a name the new copy brings fills in an earlier unnamed one, e.g. a number typed by hand and then picked).
 */
export function mergeInviteContacts(current: InviteContact[], added: InviteContact[]): InviteContact[] {
  const result = current.map((c) => ({ ...c }));
  const index = new Map(result.map((c, i) => [c.id, i]));
  for (const row of added) {
    const at = index.get(row.id);
    if (at === undefined) {
      index.set(row.id, result.length);
      result.push(row);
    } else if (!result[at].name && row.name) {
      result[at] = { ...result[at], name: row.name };
    }
  }
  return result;
}

/** Search in the picker: name, or the number in any formatting (digits are compared without spaces/dashes). */
export function matchesInviteSearch(row: InviteContact, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (row.name?.toLowerCase().includes(q)) return true;
  if (row.display.toLowerCase().includes(q)) return true;
  const digits = q.replace(/\D/g, "");
  return digits.length > 0 && row.tel.replace(/\D/g, "").includes(digits);
}
