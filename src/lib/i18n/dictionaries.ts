import { ar } from "@/lib/i18n/ar";
import { en, type Dictionary } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import { fr } from "@/lib/i18n/fr";
import { pt } from "@/lib/i18n/pt";
import type { Locale } from "@/lib/i18n/locales";

// Every language at once: for the server, which hands client components only the area they render (see
// src/components/ui-text.tsx). A client component importing this would ship all five languages. Each language is a
// folder with one module per area; en/ is the shape the others are typed against.
export const DICTIONARIES: Record<Locale, Dictionary> = { en, es, fr, pt, ar };

export function dictionaryFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}
