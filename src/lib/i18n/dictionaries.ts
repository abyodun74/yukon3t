import { en, type Dictionary } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import { fr } from "@/lib/i18n/fr";
import { pt } from "@/lib/i18n/pt";
import type { Locale } from "@/lib/i18n/locales";

// Every language at once: for the server, which hands client components only the slice they render. A client
// component importing this would ship all four languages.
export const DICTIONARIES: Record<Locale, Dictionary> = { en, es, fr, pt };

export function dictionaryFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}
