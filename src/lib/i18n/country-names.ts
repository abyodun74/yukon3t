import { intlLocale, type Locale } from "@/lib/i18n/locales";

// Countries are stored and filtered by their English name (src/lib/countries.ts). To show one in another language,
// the name is matched back to its ISO code through the runtime's own English region names and looked up again in the
// reader's language; a name the runtime spells differently is shown as stored.

// Names in src/lib/countries.ts that the runtime's English data spells another way ("Antigua & Barbuda", "Türkiye").
const CODE_BY_APP_NAME: Record<string, string> = {
  "Antigua and Barbuda": "AG",
  "Bosnia and Herzegovina": "BA",
  "Cabo Verde": "CV",
  "Congo (DRC)": "CD",
  "Congo (Republic)": "CG",
  "Ivory Coast": "CI",
  Myanmar: "MM",
  "Saint Kitts and Nevis": "KN",
  "Saint Lucia": "LC",
  "Saint Vincent and the Grenadines": "VC",
  "Sao Tome and Principe": "ST",
  "Trinidad and Tobago": "TT",
  Turkey: "TR",
};

// The two entries that are worded here rather than by the runtime: the list's own name for Palestine (the runtime's
// is "Palestinian Territories"), and the entry that is not a country. Kept in this file, not in the dictionaries,
// because client components call countryName() too and never import a dictionary.
const WORDED_HERE: Record<string, Record<Exclude<Locale, "en">, string>> = {
  Palestine: { es: "Palestina", fr: "Palestine", pt: "Palestina", ar: "فلسطين" },
  "Other / Not listed": {
    es: "Otro / No está en la lista",
    fr: "Autre / Absent de la liste",
    pt: "Outro / Não está na lista",
    ar: "بلد آخر / غير مدرج",
  },
};

let codeByEnglishName: Map<string, string> | null = null;

function codes() {
  if (codeByEnglishName) return codeByEnglishName;
  codeByEnglishName = new Map(Object.entries(CODE_BY_APP_NAME));
  const english = new Intl.DisplayNames(["en"], { type: "region" });
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const a of letters) {
    for (const b of letters) {
      const code = a + b;
      let name: string | undefined;
      try {
        name = english.of(code);
      } catch {
        name = undefined;
      }
      if (name && name !== code) codeByEnglishName.set(name, code);
    }
  }
  return codeByEnglishName;
}

/** A stored (English) country name in `locale`. The stored value itself never changes. */
export function countryName(englishName: string, locale: Locale): string {
  if (locale === "en") return englishName;
  if (Object.hasOwn(WORDED_HERE, englishName)) return WORDED_HERE[englishName][locale];
  const code = codes().get(englishName);
  if (!code) return englishName;
  try {
    return new Intl.DisplayNames([intlLocale(locale) ?? locale], { type: "region" }).of(code) ?? englishName;
  } catch {
    return englishName;
  }
}
