import { intlLocale, type Locale } from "@/lib/i18n/locales";

// Countries are stored and filtered by their English name (src/lib/countries.ts). To show one in another language,
// the name is matched back to its ISO code through the runtime's own English region names and looked up again in the
// reader's language; a name the runtime spells differently is shown as stored.

let codeByEnglishName: Map<string, string> | null = null;

function codes() {
  if (codeByEnglishName) return codeByEnglishName;
  codeByEnglishName = new Map();
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
  const code = codes().get(englishName);
  if (!code) return englishName;
  try {
    return new Intl.DisplayNames([intlLocale(locale) ?? locale], { type: "region" }).of(code) ?? englishName;
  } catch {
    return englishName;
  }
}
